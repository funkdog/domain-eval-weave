import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type ClaimDependencyGraph,
  domainPackPointerSchema,
  type ProductDomainContract,
  parseClaimDependencyGraph,
  parseProductDomainContract,
  parseRequirementChangeSet,
  type RequirementChangeSet,
} from "./contracts.js";

interface ContractInput {
  readonly ref: string;
  readonly contract: unknown;
}

interface RequirementInput {
  readonly ref: string;
  readonly requirement: unknown;
}

export interface BuildClaimDependencyGraphInput {
  readonly contract: ContractInput;
  readonly requirements: readonly RequirementInput[];
}

type GraphNode = ClaimDependencyGraph["nodes"][number];
type GraphEdge = ClaimDependencyGraph["edges"][number];

const claimNodeId = (version: number, claimId: string): string => `claim:${version}:${claimId}`;
const requirementNodeId = (version: number, requirementId: string): string =>
  `requirement:${version}:${requirementId}`;
const proposalNodeId = (version: number, requirementId: string, claimId: string): string =>
  `proposal:${version}:${requirementId}:${claimId}`;

function edgeKey(edge: GraphEdge): string {
  return `${edge.from}\0${edge.to}\0${edge.kind}`;
}

function sortNodes(nodes: readonly GraphNode[]): GraphNode[] {
  return [...nodes].sort((left, right) => left.node_id.localeCompare(right.node_id));
}

function sortEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return [...edges].sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));
}

function buildReverseIndex(edges: readonly GraphEdge[]): Record<string, string[]> {
  const reverse = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sources = reverse.get(edge.to) ?? new Set<string>();
    sources.add(edge.from);
    reverse.set(edge.to, sources);
  }
  return Object.fromEntries(
    [...reverse.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, sources]) => [target, [...sources].sort()]),
  );
}

function assertNoDependencyCycle(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): void {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.node_id, []);
  for (const edge of edges) {
    if (edge.kind === "depends_on") adjacency.get(edge.from)?.push(edge.to);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error(`Claim dependency cycle contains ${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependency of adjacency.get(nodeId) ?? []) visit(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of nodes) visit(node.node_id);
}

function assertClaimRef(
  claimId: string,
  contractVersion: number,
  contract: ProductDomainContract,
  contractClaims: ReadonlySet<string>,
): void {
  if (contractVersion !== contract.version) {
    throw new Error(
      `Claim ${claimId} pins Contract version ${contractVersion}, expected ${contract.version}`,
    );
  }
  if (!contractClaims.has(claimId))
    throw new Error(`Requirement references unknown Claim ${claimId}`);
}

function requirementEdges(
  requirement: RequirementChangeSet,
  contract: ProductDomainContract,
  contractClaims: ReadonlySet<string>,
): { readonly nodes: GraphNode[]; readonly edges: GraphEdge[] } {
  const from = requirementNodeId(requirement.version, requirement.requirement_id);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const kind of ["uses", "preserves", "deprecates"] as const) {
    for (const reference of requirement.effects[kind]) {
      assertClaimRef(reference.claim_id, reference.contract_version, contract, contractClaims);
      edges.push({ from, to: claimNodeId(reference.contract_version, reference.claim_id), kind });
    }
  }
  for (const conflict of requirement.effects.conflicts_with) {
    assertClaimRef(
      conflict.claim.claim_id,
      conflict.claim.contract_version,
      contract,
      contractClaims,
    );
    edges.push({
      from,
      to: claimNodeId(conflict.claim.contract_version, conflict.claim.claim_id),
      kind: "conflicts_with",
    });
  }
  for (const proposed of requirement.effects.introduces) {
    const proposalId = proposalNodeId(
      requirement.version,
      requirement.requirement_id,
      proposed.claim_id,
    );
    nodes.push({
      node_id: proposalId,
      kind: "proposed_claim",
      object_id: proposed.claim_id,
      object_version: requirement.version,
      domain_id: proposed.domain_id,
    });
    edges.push({ from, to: proposalId, kind: "introduces" });
  }
  for (const modification of requirement.effects.modifies) {
    assertClaimRef(
      modification.claim.claim_id,
      modification.claim.contract_version,
      contract,
      contractClaims,
    );
    const proposalId = proposalNodeId(
      requirement.version,
      requirement.requirement_id,
      modification.proposed.claim_id,
    );
    nodes.push({
      node_id: proposalId,
      kind: "proposed_claim",
      object_id: modification.proposed.claim_id,
      object_version: requirement.version,
      domain_id: modification.proposed.domain_id,
    });
    edges.push({ from, to: proposalId, kind: "modifies" });
    edges.push({
      from: proposalId,
      to: claimNodeId(modification.claim.contract_version, modification.claim.claim_id),
      kind: "depends_on",
    });
  }
  return { nodes, edges };
}

export function buildClaimDependencyGraph(
  input: BuildClaimDependencyGraphInput,
): ClaimDependencyGraph {
  const contract = parseProductDomainContract(input.contract.contract);
  const contractPointer = domainPackPointerSchema.parse({
    ref: input.contract.ref,
    sha256: canonicalJsonDigest(contract),
  });
  const contractClaims = new Set(contract.claims.map((claim) => claim.claim_id));
  const nodes: GraphNode[] = contract.claims.map((claim) => ({
    node_id: claimNodeId(contract.version, claim.claim_id),
    kind: "contract_claim",
    object_id: claim.claim_id,
    object_version: contract.version,
    domain_id: claim.domain_id,
  }));
  const edges: GraphEdge[] = contract.claims.flatMap((claim) =>
    claim.dependencies.map((dependency) => ({
      from: claimNodeId(contract.version, claim.claim_id),
      to: claimNodeId(dependency.contract_version, dependency.claim_id),
      kind: "depends_on" as const,
    })),
  );
  for (const claim of contract.claims) {
    if (claim.transition === undefined) continue;
    const historicalId = claimNodeId(
      claim.transition.predecessor.contract_version,
      claim.transition.predecessor.claim_id,
    );
    if (!nodes.some((node) => node.node_id === historicalId)) {
      nodes.push({
        node_id: historicalId,
        kind: "historical_claim",
        object_id: claim.transition.predecessor.claim_id,
        object_version: claim.transition.predecessor.contract_version,
        domain_id: claim.domain_id,
      });
    }
    edges.push({
      from: claimNodeId(contract.version, claim.claim_id),
      to: historicalId,
      kind: claim.transition.kind,
    });
  }

  const requirements = input.requirements.map((artifact) => ({
    ref: artifact.ref,
    requirement: parseRequirementChangeSet(artifact.requirement),
  }));
  const requirementKeys = requirements.map(
    ({ requirement }) => `${requirement.requirement_id}\0${requirement.version}`,
  );
  if (new Set(requirementKeys).size !== requirementKeys.length) {
    throw new Error("Requirement id+version pairs must be unique within one graph");
  }

  for (const { requirement } of requirements) {
    if (requirement.product_id !== contract.product_id) {
      throw new Error(`Requirement ${requirement.requirement_id} belongs to another product`);
    }
    if (
      requirement.base_contract.ref !== contractPointer.ref ||
      requirement.base_contract.sha256 !== contractPointer.sha256
    ) {
      throw new Error(`Requirement ${requirement.requirement_id} does not pin the exact Contract`);
    }
    nodes.push({
      node_id: requirementNodeId(requirement.version, requirement.requirement_id),
      kind: "requirement",
      object_id: requirement.requirement_id,
      object_version: requirement.version,
    });
    const contribution = requirementEdges(requirement, contract, contractClaims);
    nodes.push(...contribution.nodes);
    edges.push(...contribution.edges);
  }

  if (new Set(nodes.map((node) => node.node_id)).size !== nodes.length) {
    throw new Error("Claim graph node ids must be unique");
  }
  if (new Set(edges.map(edgeKey)).size !== edges.length) {
    throw new Error("Claim graph edges must be unique");
  }
  assertNoDependencyCycle(nodes, edges);

  const sortedNodes = sortNodes(nodes);
  const sortedEdges = sortEdges(edges);
  const requirementPointers = requirements
    .map(({ ref, requirement }) =>
      domainPackPointerSchema.parse({ ref, sha256: canonicalJsonDigest(requirement) }),
    )
    .sort((left, right) => left.ref.localeCompare(right.ref));
  const graph = parseClaimDependencyGraph({
    schema_version: 1,
    graph_id: `graph-${contract.product_id}-${canonicalJsonDigest({
      contract: contractPointer,
      requirements: requirementPointers,
      nodes: sortedNodes,
      edges: sortedEdges,
    }).slice(0, 12)}`,
    product_id: contract.product_id,
    contract: contractPointer,
    requirements: requirementPointers,
    nodes: sortedNodes,
    edges: sortedEdges,
    reverse_index: buildReverseIndex(sortedEdges),
  });
  assertClaimDependencyGraphSemantics(graph);
  return graph;
}

export function assertClaimDependencyGraphSemantics(graph: ClaimDependencyGraph): void {
  const expectedReverse = buildReverseIndex(graph.edges);
  if (canonicalJson(expectedReverse) !== canonicalJson(graph.reverse_index)) {
    throw new Error("Claim graph reverse index does not match edges");
  }
  assertNoDependencyCycle(graph.nodes, graph.edges);
}

export interface ClaimImpact {
  readonly dependent_claim_ids: readonly string[];
  readonly proposed_claim_ids: readonly string[];
  readonly requirement_ids: readonly string[];
}

export function impactedByClaim(graph: ClaimDependencyGraph, claimId: string): ClaimImpact {
  assertClaimDependencyGraphSemantics(graph);
  const byId = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const start = graph.nodes.find(
    (node) => node.kind === "contract_claim" && node.object_id === claimId,
  )?.node_id;
  if (start === undefined || byId.get(start)?.kind !== "contract_claim") {
    throw new Error(`unknown Contract Claim ${claimId}`);
  }

  const pending = [...(graph.reverse_index[start] ?? [])];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (nodeId === undefined || seen.has(nodeId)) continue;
    seen.add(nodeId);
    pending.push(...(graph.reverse_index[nodeId] ?? []));
  }

  const dependentClaims = new Set<string>();
  const proposedClaims = new Set<string>();
  const requirements = new Set<string>();
  for (const nodeId of seen) {
    const node = byId.get(nodeId);
    if (node?.kind === "contract_claim") dependentClaims.add(node.object_id);
    if (node?.kind === "proposed_claim") proposedClaims.add(node.object_id);
    if (node?.kind === "requirement") requirements.add(node.object_id);
  }
  return {
    dependent_claim_ids: [...dependentClaims].sort(),
    proposed_claim_ids: [...proposedClaims].sort(),
    requirement_ids: [...requirements].sort(),
  };
}
