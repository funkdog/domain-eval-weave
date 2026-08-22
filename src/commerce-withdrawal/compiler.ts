import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import type { DomainSourceRef, ProductDomainContract } from "../domain/contracts.js";
import type { ValidatedDomainPack } from "../domain/pack.js";
import { COMMERCE_BEHAVIORS, type CommerceBehavior } from "../oracle/commerce-order-v2.js";
import { parseCommerceObservationCatalog } from "./catalog.js";
import {
  type CommerceClaimIr,
  type CommerceObservationCatalog,
  type CommerceOraclePlan,
  parseCommerceClaimIr,
  parseCommerceOraclePlan,
} from "./delivery-contracts.js";

type ContractClaim = ProductDomainContract["claims"][number];
type ClaimEffect = "uses" | "preserves";

export class CommerceCompilerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommerceCompilerError";
    this.code = code;
  }
}

function samePointer(
  left: { readonly ref: string; readonly sha256: string },
  right: { readonly ref: string; readonly sha256: string },
): boolean {
  return left.ref === right.ref && left.sha256 === right.sha256;
}

function binding(
  source: DomainSourceRef,
  catalog: CommerceObservationCatalog,
): { readonly behavior_id: CommerceBehavior; readonly entry_sha256: string } | undefined {
  if (source.kind !== "test") return undefined;
  if (source.artifact_ref !== "sources/commerce-order-observation-catalog.json") {
    throw new CommerceCompilerError(
      "COMMERCE_OBSERVATION_SOURCE_UNSUPPORTED",
      "commerce test observation must use the frozen Domain Pack catalog snapshot",
    );
  }
  const match = /^\/behaviors\/([0-9]|1[0-5])$/.exec(source.locator ?? "");
  if (match === null) {
    throw new CommerceCompilerError(
      "COMMERCE_OBSERVATION_LOCATOR_UNSUPPORTED",
      "commerce observation must point to one frozen behavior",
    );
  }
  const index = Number(match[1]);
  const entry = catalog.behaviors[index];
  if (entry === undefined || entry.behavior_id !== COMMERCE_BEHAVIORS[index]) {
    throw new CommerceCompilerError(
      "COMMERCE_OBSERVATION_CATALOG_INVALID",
      "commerce observation catalog order drifted",
    );
  }
  const digest = canonicalJsonDigest(entry);
  if (source.digest !== digest) {
    throw new CommerceCompilerError(
      "COMMERCE_OBSERVATION_BINDING_DRIFT",
      `commerce observation digest drifted: ${entry.behavior_id}`,
    );
  }
  return { behavior_id: entry.behavior_id, entry_sha256: digest };
}

function bindings(claim: ContractClaim, catalog: CommerceObservationCatalog) {
  const values = claim.observation_refs
    .map((source) => binding(source, catalog))
    .filter((value) => value !== undefined)
    .sort(
      (left, right) =>
        COMMERCE_BEHAVIORS.indexOf(left.behavior_id) -
        COMMERCE_BEHAVIORS.indexOf(right.behavior_id),
    );
  if (new Set(values.map((value) => value.behavior_id)).size !== values.length) {
    throw new CommerceCompilerError(
      "COMMERCE_OBSERVATION_BINDING_DUPLICATE",
      `Claim ${claim.claim_id} binds one commerce behavior more than once`,
    );
  }
  return values;
}

function claimRefKey(ref: { readonly claim_id: string; readonly contract_version: number }) {
  return `${ref.claim_id}@${ref.contract_version}`;
}

function buildChecks(
  claimIr: CommerceClaimIr,
  catalog: CommerceObservationCatalog,
): CommerceOraclePlan["checks"] {
  const catalogDigest = canonicalJsonDigest(catalog);
  if (claimIr.source.observation_catalog_sha256 !== catalogDigest) {
    throw new CommerceCompilerError(
      "COMMERCE_CATALOG_DRIFT",
      "Commerce Claim IR does not bind the supplied catalog",
    );
  }
  const catalogByBehavior = new Map(catalog.behaviors.map((entry) => [entry.behavior_id, entry]));
  const claimById = new Map(claimIr.claims.map((claim) => [claim.claim_id, claim]));
  for (const claim of claimIr.claims) {
    for (const observation of claim.observation_bindings) {
      const entry = catalogByBehavior.get(observation.behavior_id);
      if (entry === undefined || observation.entry_sha256 !== canonicalJsonDigest(entry)) {
        throw new CommerceCompilerError(
          "COMMERCE_BINDING_DRIFT",
          `Commerce binding drifted from catalog: ${claim.claim_id}`,
        );
      }
    }
  }
  return COMMERCE_BEHAVIORS.map((behavior) => {
    const entry = catalogByBehavior.get(behavior);
    const claimIds = claimIr.traceability.behavior_to_claims[behavior];
    if (entry === undefined || claimIds.length === 0) {
      throw new CommerceCompilerError(
        "COMMERCE_PLAN_INCOMPLETE",
        `Commerce behavior lacks an impacted Claim: ${behavior}`,
      );
    }
    const projected = claimIds.map((claimId) => claimById.get(claimId)?.axis);
    if (projected.includes(undefined)) {
      throw new CommerceCompilerError(
        "COMMERCE_PLAN_TRACE_INVALID",
        `Commerce behavior points to an unknown Claim: ${behavior}`,
      );
    }
    const axes = [...new Set(projected)].filter(
      (axis): axis is CommerceClaimIr["claims"][number]["axis"] => axis !== undefined,
    );
    return {
      behavior_id: behavior,
      template_id: "commerce-order-cancellation-v2" as const,
      claim_ids: claimIds,
      axes,
      risk_weight: entry.risk_weight,
      hard_gate: true as const,
    };
  });
}

export function rebuildCommerceOraclePlan(input: {
  readonly claimIr: unknown;
  readonly catalog: unknown;
}): CommerceOraclePlan {
  const claimIr = parseCommerceClaimIr(input.claimIr);
  const catalog = parseCommerceObservationCatalog(input.catalog);
  return parseCommerceOraclePlan({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v2",
    plan_id: `${claimIr.requirement.requirement_id}-v${claimIr.requirement.requirement_version}`,
    claim_ir_sha256: canonicalJsonDigest(claimIr),
    task_pack_sha256: claimIr.source.task_pack_sha256,
    observation_catalog_sha256: canonicalJsonDigest(catalog),
    oracle_version: catalog.oracle_version,
    checks: buildChecks(claimIr, catalog),
  });
}

export function replayCommerceOraclePlan(input: {
  readonly claimIr: unknown;
  readonly oraclePlan: unknown;
  readonly catalog: unknown;
}): CommerceOraclePlan {
  const plan = parseCommerceOraclePlan(input.oraclePlan);
  const rebuilt = rebuildCommerceOraclePlan({ claimIr: input.claimIr, catalog: input.catalog });
  if (canonicalJson(plan) !== canonicalJson(rebuilt)) {
    throw new CommerceCompilerError(
      "COMMERCE_PLAN_SEMANTIC_DRIFT",
      "Commerce Oracle Plan semantic replay drifted from Claim IR and catalog",
    );
  }
  return plan;
}

export function compileCommerceGrader(input: {
  readonly pack: ValidatedDomainPack;
  readonly requirementId: string;
  readonly taskPackDigest: string;
  readonly catalog: unknown;
}): { readonly claimIr: CommerceClaimIr; readonly oraclePlan: CommerceOraclePlan } {
  const catalog = parseCommerceObservationCatalog(input.catalog);
  const requirementArtifact = input.pack.requirements.find(
    (artifact) => artifact.value.requirement_id === input.requirementId,
  );
  if (requirementArtifact === undefined) {
    throw new CommerceCompilerError("COMMERCE_REQUIREMENT_NOT_FOUND", "Requirement is absent");
  }
  const requirement = requirementArtifact.value;
  const contract = input.pack.contract;
  if (input.pack.manifest.contract.sha256 !== canonicalJsonDigest(contract)) {
    throw new CommerceCompilerError(
      "COMMERCE_CONTRACT_POINTER_DRIFT",
      "Contract bytes do not match the Domain Pack manifest",
    );
  }
  if (
    requirement.status !== "owner_confirmed" ||
    requirement.product_id !== contract.product_id ||
    requirement.product_id !== input.pack.manifest.product_id
  ) {
    throw new CommerceCompilerError(
      "COMMERCE_REQUIREMENT_NOT_CONFIRMED",
      "Requirement and Contract must share one confirmed product",
    );
  }
  if (!samePointer(requirement.base_contract, input.pack.manifest.contract)) {
    throw new CommerceCompilerError(
      "COMMERCE_REQUIREMENT_CONTRACT_DRIFT",
      "Requirement base Contract does not match the manifest",
    );
  }
  const manifestRequirement = input.pack.manifest.requirements.find(
    (pointer) => pointer.ref === requirementArtifact.ref,
  );
  if (
    manifestRequirement === undefined ||
    manifestRequirement.sha256 !== canonicalJsonDigest(requirement)
  ) {
    throw new CommerceCompilerError(
      "COMMERCE_REQUIREMENT_POINTER_DRIFT",
      "Requirement bytes do not match the manifest",
    );
  }
  if (requirement.effects.deprecates.length > 0 || requirement.effects.conflicts_with.length > 0) {
    throw new CommerceCompilerError(
      "COMMERCE_REQUIREMENT_EFFECT_UNSUPPORTED",
      "Commerce withdrawal template refuses deprecations and declared conflicts",
    );
  }

  const claimById = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const effects = new Map<string, ClaimEffect>();
  const addEffect = (
    ref: { readonly claim_id: string; readonly contract_version: number },
    effect: ClaimEffect,
  ) => {
    const claim = claimById.get(ref.claim_id);
    if (
      claim === undefined ||
      claim.lifecycle !== "active" ||
      ref.contract_version !== contract.version
    ) {
      throw new CommerceCompilerError(
        "COMMERCE_CLAIM_REF_INVALID",
        `Claim ref is not active in Contract v${contract.version}: ${claimRefKey(ref)}`,
      );
    }
    const current = effects.get(ref.claim_id);
    if (current === undefined || (current === "preserves" && effect === "uses")) {
      effects.set(ref.claim_id, effect);
    }
  };
  for (const ref of requirement.effects.uses) addEffect(ref, "uses");
  for (const ref of requirement.effects.preserves) addEffect(ref, "preserves");
  const queue = [...effects.keys()];
  for (let index = 0; index < queue.length; index += 1) {
    const claimId = queue[index];
    if (claimId === undefined) continue;
    const claim = claimById.get(claimId);
    if (claim === undefined) continue;
    for (const dependency of claim.dependencies) {
      const existed = effects.has(dependency.claim_id);
      addEffect(dependency, "preserves");
      if (!existed) queue.push(dependency.claim_id);
    }
  }

  const deterministicClaims: CommerceClaimIr["claims"][number][] = [];
  const semanticResidual: CommerceClaimIr["semantic_residual"][number][] = [];
  for (const [claimId, effect] of effects) {
    const claim = claimById.get(claimId);
    if (claim === undefined) continue;
    const observations = bindings(claim, catalog);
    const axis = effect === "uses" ? "requirement_delta" : "domain_preservation";
    if (observations.length === 0) {
      semanticResidual.push({
        claim_id: claim.claim_id,
        axis,
        reason_code: "OBSERVATION_BINDING_MISSING",
      });
      continue;
    }
    deterministicClaims.push({
      claim_id: claim.claim_id,
      contract_version: contract.version,
      domain_id: claim.domain_id,
      effect,
      axis,
      statement_sha256: sha256Hex(claim.statement),
      false_accept_risk: claim.false_accept_risk,
      false_reject_risk: claim.false_reject_risk,
      dependencies: claim.dependencies.map((dependency) => dependency.claim_id),
      observation_bindings: observations,
    });
  }
  for (const proposed of requirement.effects.introduces) {
    semanticResidual.push({
      claim_id: proposed.claim_id,
      axis: "requirement_delta",
      reason_code: "PROPOSED_CLAIM_RISK_UNSPECIFIED",
    });
  }
  for (const modification of requirement.effects.modifies) {
    semanticResidual.push({
      claim_id: modification.proposed.claim_id,
      axis: "requirement_delta",
      reason_code: "PROPOSED_CLAIM_RISK_UNSPECIFIED",
    });
  }
  const claimToBehaviors = Object.fromEntries(
    deterministicClaims.map((claim) => [
      claim.claim_id,
      claim.observation_bindings.map((observation) => observation.behavior_id),
    ]),
  );
  const behaviorToClaims = Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [
      behavior,
      deterministicClaims
        .filter((claim) =>
          claim.observation_bindings.some((observation) => observation.behavior_id === behavior),
        )
        .map((claim) => claim.claim_id),
    ]),
  );
  const claimIr = parseCommerceClaimIr({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v2",
    compiler: { compiler_id: "phase3b2-commerce-compiler", compiler_version: 1 },
    source: {
      domain_manifest: {
        ref: input.pack.manifestRef,
        sha256: canonicalJsonDigest(input.pack.manifest),
      },
      contract: input.pack.manifest.contract,
      requirement: manifestRequirement,
      task_pack_sha256: input.taskPackDigest,
      observation_catalog_sha256: canonicalJsonDigest(catalog),
    },
    requirement: {
      requirement_id: requirement.requirement_id,
      requirement_version: requirement.version,
      product_id: requirement.product_id,
    },
    claims: deterministicClaims,
    semantic_residual: semanticResidual,
    traceability: {
      claim_to_behaviors: claimToBehaviors,
      behavior_to_claims: behaviorToClaims,
    },
  });
  return { claimIr, oraclePlan: rebuildCommerceOraclePlan({ claimIr, catalog }) };
}
