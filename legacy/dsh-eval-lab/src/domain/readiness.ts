import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type DomainTruthReadiness,
  domainPackPointerSchema,
  parseClaimDependencyGraph,
  parseDomainDecisionQuestion,
  parseDomainEvidenceCard,
  parseDomainReadinessRequest,
  parseDomainTruthReadiness,
  parseRequirementChangeSet,
} from "./contracts.js";
import { assertClaimDependencyGraphSemantics } from "./graph.js";

interface ArtifactInput {
  readonly ref: string;
  readonly value: unknown;
}

export interface BuildDomainTruthReadinessInput {
  readonly contract: { readonly ref: string; readonly sha256: string };
  readonly requirements: readonly { readonly ref: string; readonly requirement: unknown }[];
  readonly graph: { readonly ref: string; readonly graph: unknown };
  readonly evidenceCards: readonly { readonly ref: string; readonly card: unknown }[];
  readonly decisionQuestions: readonly { readonly ref: string; readonly question: unknown }[];
  readonly request: { readonly ref: string; readonly request: unknown };
  readonly generatedAt: string;
}

type ReadinessDimension =
  DomainTruthReadiness["dimensions"][keyof DomainTruthReadiness["dimensions"]];
type ReadinessReason = ReadinessDimension["reasons"][number];
type ReasonWithSeverity = ReadinessReason & { readonly severity: "warning" | "fail" };

function dimension(reasons: readonly ReasonWithSeverity[]): ReadinessDimension {
  if (reasons.length === 0) return { status: "pass", reasons: [] };
  return {
    status: reasons.some((reason) => reason.severity === "fail") ? "fail" : "warning",
    reasons: reasons.map(({ severity: _severity, ...reason }) => reason),
  };
}

const severityForRisk = (risk: string): "warning" | "fail" =>
  risk === "high" || risk === "critical" ? "fail" : "warning";

function requestedClosure(
  graph: ReturnType<typeof parseClaimDependencyGraph>,
  requirements: readonly { readonly id: string; readonly version: number }[],
): string[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.node_id));
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, new Set());
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  const pending = requirements.map(({ id, version }) => `requirement:${version}:${id}`);
  for (const nodeId of pending) {
    if (!nodeIds.has(nodeId)) throw new Error(`readiness request references unknown ${nodeId}`);
  }
  const seen = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (nodeId === undefined || seen.has(nodeId)) continue;
    seen.add(nodeId);
    pending.push(...(adjacency.get(nodeId) ?? []));
  }
  return [...seen].sort();
}

function pointer(artifact: ArtifactInput) {
  return domainPackPointerSchema.parse({
    ref: artifact.ref,
    sha256: canonicalJsonDigest(artifact.value),
  });
}

export function buildDomainTruthReadiness(
  input: BuildDomainTruthReadinessInput,
): DomainTruthReadiness {
  const contract = domainPackPointerSchema.parse(input.contract);
  const requirements = input.requirements.map((artifact) => ({
    ref: artifact.ref,
    requirement: parseRequirementChangeSet(artifact.requirement),
  }));
  const graph = parseClaimDependencyGraph(input.graph.graph);
  assertClaimDependencyGraphSemantics(graph);
  const request = parseDomainReadinessRequest(input.request.request);
  if (request.product_id !== graph.product_id) throw new Error("readiness request product drifted");
  const requirementByRef = new Map(requirements.map((artifact) => [artifact.ref, artifact]));
  const requestedRequirements = request.requirements.map((requested) => {
    const artifact = requirementByRef.get(requested.ref);
    if (artifact === undefined || canonicalJsonDigest(artifact.requirement) !== requested.sha256) {
      throw new Error("readiness request does not bind an exact Requirement artifact");
    }
    return { id: artifact.requirement.requirement_id, version: artifact.requirement.version };
  });
  const closure = requestedClosure(graph, requestedRequirements);
  const closureSet = new Set(closure);
  const closureClaimIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          closureSet.has(node.node_id) &&
          (node.kind === "contract_claim" || node.kind === "proposed_claim"),
      )
      .map((node) => node.object_id),
  );
  const closureRequirementIds = new Set(
    graph.nodes
      .filter((node) => closureSet.has(node.node_id) && node.kind === "requirement")
      .map((node) => node.object_id),
  );
  const cards = input.evidenceCards.map((artifact) => ({
    ref: artifact.ref,
    card: parseDomainEvidenceCard(artifact.card),
  }));
  const questions = input.decisionQuestions.map((artifact) => ({
    ref: artifact.ref,
    question: parseDomainDecisionQuestion(artifact.question),
  }));

  const ownerReasons: ReasonWithSeverity[] = [];
  const conflictReasons: ReasonWithSeverity[] = [];
  const observationReasons: ReasonWithSeverity[] = [];
  for (const { ref, card } of cards) {
    if (!closureClaimIds.has(card.claim_id)) continue;
    const reason: ReasonWithSeverity = {
      code: `EVIDENCE_${card.status.toUpperCase()}`,
      message: `Claim ${card.claim_id} remains ${card.status}.`,
      artifact_refs: [ref],
      severity: severityForRisk(card.false_accept_risk),
    };
    if (card.status === "proposed" || card.status === "unresolved") ownerReasons.push(reason);
    if (card.status === "conflicted") conflictReasons.push(reason);
    if (card.status === "observability_gap") observationReasons.push(reason);
  }

  const bindingReasons: ReasonWithSeverity[] = [];
  const questionsByRef = new Map(questions.map((artifact) => [artifact.ref, artifact]));
  for (const { ref, requirement } of requirements) {
    if (!closureRequirementIds.has(requirement.requirement_id)) continue;
    if (requirement.status !== "owner_confirmed") {
      bindingReasons.push({
        code: "REQUIREMENT_NOT_CONFIRMED",
        message: `Requirement ${requirement.requirement_id} is not owner-confirmed.`,
        artifact_refs: [ref],
        severity: "fail",
      });
    }
    for (const questionPointer of requirement.decision_question_refs) {
      const artifact = questionsByRef.get(questionPointer.ref);
      if (
        artifact === undefined ||
        canonicalJsonDigest(artifact.question) !== questionPointer.sha256
      ) {
        bindingReasons.push({
          code: "DECISION_QUESTION_INVALID",
          message: `Requirement ${requirement.requirement_id} has an invalid decision question pointer.`,
          artifact_refs: [ref],
          severity: "fail",
        });
        continue;
      }
      if (artifact.question.status === "open") {
        bindingReasons.push({
          code: "DECISION_QUESTION_OPEN",
          message: `Decision question ${artifact.question.question_id} remains open.`,
          artifact_refs: [artifact.ref],
          severity: artifact.question.blocking ? "fail" : "warning",
        });
      }
    }
  }
  for (const { ref, question } of questions) {
    if (
      question.requirement_id === undefined &&
      question.blocked_claim_ids.some((claimId) => closureClaimIds.has(claimId)) &&
      question.status === "open"
    ) {
      bindingReasons.push({
        code: "DECISION_QUESTION_OPEN",
        message: `Decision question ${question.question_id} remains open.`,
        artifact_refs: [ref],
        severity: question.blocking ? "fail" : "warning",
      });
    }
  }

  const dimensions = {
    source_integrity: dimension([]),
    owner_confirmation: dimension(ownerReasons),
    conflict_state: dimension(conflictReasons),
    observability: dimension(observationReasons),
    requirement_binding: dimension(bindingReasons),
    impact_closure: dimension([]),
    artifact_replay: dimension([]),
  } as const;
  const statuses = Object.values(dimensions).map((candidate) => candidate.status);
  const overall = statuses.includes("fail")
    ? "red"
    : statuses.includes("warning")
      ? "yellow"
      : "green";

  return parseDomainTruthReadiness({
    schema_version: 1,
    report_id: `report-${request.request_id}`,
    product_id: graph.product_id,
    contract,
    requirements: requirements
      .map((artifact) => pointer({ ref: artifact.ref, value: artifact.requirement }))
      .sort((left, right) => left.ref.localeCompare(right.ref)),
    graph: pointer({ ref: input.graph.ref, value: graph }),
    request: pointer({ ref: input.request.ref, value: request }),
    requested_closure_node_ids: closure,
    dimensions,
    overall,
    claim_strength: "domain_truth_ready",
    generated_at: input.generatedAt,
  });
}
