import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import type { DomainSourceRef, ProductDomainContract } from "../domain/contracts.js";
import type { ValidatedDomainPack } from "../domain/pack.js";
import { LEDGER_BEHAVIORS, type LedgerBehavior } from "../oracle/ledger.js";
import {
  type ClaimIr,
  type ObservationCatalog,
  type OraclePlan,
  parseClaimIr,
  parseObservationCatalog,
  parseOraclePlan,
} from "./contracts.js";

type ContractClaim = ProductDomainContract["claims"][number];
type ClaimEffect = "uses" | "preserves";

export class DeterministicCompilerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeterministicCompilerError";
    this.code = code;
  }
}

function oracleChecks(claimIr: ClaimIr, catalog: ObservationCatalog): OraclePlan["checks"] {
  const catalogDigest = canonicalJsonDigest(catalog);
  if (claimIr.source.observation_catalog_sha256 !== catalogDigest) {
    throw new DeterministicCompilerError(
      "ORACLE_CATALOG_DRIFT",
      "Claim IR does not bind the supplied observation catalog",
    );
  }
  const catalogByBehavior = new Map(catalog.behaviors.map((entry) => [entry.behavior_id, entry]));
  const claimByCompiledId = new Map(claimIr.claims.map((claim) => [claim.claim_id, claim]));
  for (const claim of claimIr.claims) {
    for (const binding of claim.observation_bindings) {
      const entry = catalogByBehavior.get(binding.behavior_id);
      if (entry === undefined || binding.entry_sha256 !== canonicalJsonDigest(entry)) {
        throw new DeterministicCompilerError(
          "ORACLE_BINDING_DRIFT",
          `Claim observation binding drifted from the catalog: ${claim.claim_id}`,
        );
      }
    }
  }
  return LEDGER_BEHAVIORS.map((behavior) => {
    const catalogEntry = catalogByBehavior.get(behavior);
    const claimIds = claimIr.traceability.behavior_to_claims[behavior];
    if (catalogEntry === undefined || claimIds.length === 0) {
      throw new DeterministicCompilerError(
        "ORACLE_PLAN_INCOMPLETE",
        `bounded template behavior is not covered by an impacted Claim: ${behavior}`,
      );
    }
    const projectedAxes = claimIds.map((claimId) => claimByCompiledId.get(claimId)?.axis);
    if (projectedAxes.includes(undefined)) {
      throw new DeterministicCompilerError(
        "ORACLE_PLAN_TRACE_INVALID",
        `Oracle behavior points to an unknown Claim: ${behavior}`,
      );
    }
    const axes = [...new Set(projectedAxes)].filter(
      (axis): axis is ClaimIr["claims"][number]["axis"] => axis !== undefined,
    );
    return {
      behavior_id: behavior,
      template_id: catalogEntry.template_id,
      claim_ids: claimIds,
      axes,
      risk_weight: catalogEntry.risk_weight,
      hard_gate: true,
    };
  });
}

export function rebuildOraclePlan(input: {
  readonly claimIr: unknown;
  readonly catalog: unknown;
}): OraclePlan {
  const claimIr = parseClaimIr(input.claimIr);
  const catalog = parseObservationCatalog(input.catalog);
  return parseOraclePlan({
    schema_version: 1,
    plan_id: `${claimIr.requirement.requirement_id}-v${claimIr.requirement.requirement_version}`,
    claim_ir_sha256: canonicalJsonDigest(claimIr),
    task_pack_sha256: claimIr.source.task_pack_sha256,
    observation_catalog_sha256: canonicalJsonDigest(catalog),
    oracle_version: catalog.oracle_version,
    checks: oracleChecks(claimIr, catalog),
  });
}

export function replayOraclePlanSemantics(input: {
  readonly claimIr: unknown;
  readonly oraclePlan: unknown;
  readonly catalog: unknown;
}): OraclePlan {
  const oraclePlan = parseOraclePlan(input.oraclePlan);
  const rebuilt = rebuildOraclePlan({ claimIr: input.claimIr, catalog: input.catalog });
  if (canonicalJson(oraclePlan) !== canonicalJson(rebuilt)) {
    throw new DeterministicCompilerError(
      "ORACLE_PLAN_SEMANTIC_DRIFT",
      "Oracle Plan semantic replay drifted from Claim IR and the frozen catalog",
    );
  }
  return oraclePlan;
}

function samePointer(
  left: { readonly ref: string; readonly sha256: string },
  right: { readonly ref: string; readonly sha256: string },
): boolean {
  return left.ref === right.ref && left.sha256 === right.sha256;
}

function observationBinding(
  source: DomainSourceRef,
  catalog: ObservationCatalog,
): { readonly behavior_id: LedgerBehavior; readonly entry_sha256: string } | undefined {
  if (source.kind !== "test") return undefined;
  if (source.artifact_ref !== "sources/claim-observation-catalog.json") {
    throw new DeterministicCompilerError(
      "OBSERVATION_SOURCE_UNSUPPORTED",
      "test observation binding must use the frozen Domain Pack catalog snapshot",
    );
  }
  const match = /^\/behaviors\/(0|1|2|3|4|5|6|7)$/.exec(source.locator ?? "");
  if (match === null) {
    throw new DeterministicCompilerError(
      "OBSERVATION_LOCATOR_UNSUPPORTED",
      "test observation binding must point to one frozen catalog behavior",
    );
  }
  const index = Number(match[1]);
  const entry = catalog.behaviors[index];
  if (entry === undefined || entry.behavior_id !== LEDGER_BEHAVIORS[index]) {
    throw new DeterministicCompilerError(
      "OBSERVATION_CATALOG_INVALID",
      "observation catalog behavior order drifted",
    );
  }
  const entrySha256 = canonicalJsonDigest(entry);
  if (source.digest !== entrySha256) {
    throw new DeterministicCompilerError(
      "OBSERVATION_BINDING_DRIFT",
      `observation binding digest drifted for ${entry.behavior_id}`,
    );
  }
  return { behavior_id: entry.behavior_id, entry_sha256: entrySha256 };
}

function uniqueBindings(claim: ContractClaim, catalog: ObservationCatalog) {
  const bindings = claim.observation_refs
    .map((source) => observationBinding(source, catalog))
    .filter((binding) => binding !== undefined)
    .sort(
      (left, right) =>
        LEDGER_BEHAVIORS.indexOf(left.behavior_id) - LEDGER_BEHAVIORS.indexOf(right.behavior_id),
    );
  if (new Set(bindings.map((binding) => binding.behavior_id)).size !== bindings.length) {
    throw new DeterministicCompilerError(
      "OBSERVATION_BINDING_DUPLICATE",
      `Claim ${claim.claim_id} binds one behavior more than once`,
    );
  }
  return bindings;
}

function claimRefKey(ref: {
  readonly claim_id: string;
  readonly contract_version: number;
}): string {
  return `${ref.claim_id}@${ref.contract_version}`;
}

export function compileValidatedDeterministicGrader(input: {
  readonly pack: ValidatedDomainPack;
  readonly requirementId: string;
  readonly taskPackDigest: string;
  readonly catalog: unknown;
}): { readonly claimIr: ClaimIr; readonly oraclePlan: OraclePlan } {
  const catalog = parseObservationCatalog(input.catalog);
  const requirementArtifact = input.pack.requirements.find(
    (artifact) => artifact.value.requirement_id === input.requirementId,
  );
  if (requirementArtifact === undefined) {
    throw new DeterministicCompilerError(
      "REQUIREMENT_NOT_FOUND",
      "Requirement is absent from the validated Domain Pack",
    );
  }
  const requirement = requirementArtifact.value;
  const contract = input.pack.contract;
  if (input.pack.manifest.contract.sha256 !== canonicalJsonDigest(contract)) {
    throw new DeterministicCompilerError(
      "CONTRACT_POINTER_DRIFT",
      "issued Contract bytes do not match the Domain Pack manifest",
    );
  }
  if (
    requirement.status !== "owner_confirmed" ||
    requirement.product_id !== contract.product_id ||
    requirement.product_id !== input.pack.manifest.product_id
  ) {
    throw new DeterministicCompilerError(
      "REQUIREMENT_NOT_CONFIRMED",
      "Requirement and issued Contract must share one confirmed product identity",
    );
  }
  if (!samePointer(requirement.base_contract, input.pack.manifest.contract)) {
    throw new DeterministicCompilerError(
      "REQUIREMENT_CONTRACT_DRIFT",
      "Requirement base Contract does not match the validated Domain Pack manifest",
    );
  }
  const manifestRequirement = input.pack.manifest.requirements.find(
    (pointer) => pointer.ref === requirementArtifact.ref,
  );
  if (
    manifestRequirement === undefined ||
    manifestRequirement.sha256 !== canonicalJsonDigest(requirement)
  ) {
    throw new DeterministicCompilerError(
      "REQUIREMENT_POINTER_DRIFT",
      "Requirement bytes do not match the Domain Pack manifest",
    );
  }
  if (requirement.effects.deprecates.length > 0 || requirement.effects.conflicts_with.length > 0) {
    throw new DeterministicCompilerError(
      "REQUIREMENT_EFFECT_UNSUPPORTED",
      "Phase 3B v1 refuses declared Claim conflicts or deprecations",
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
      throw new DeterministicCompilerError(
        "CLAIM_REF_INVALID",
        `Requirement Claim ref is not active in Contract v${contract.version}: ${claimRefKey(ref)}`,
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

  const deterministicClaims: ClaimIr["claims"][number][] = [];
  const semanticResidual: ClaimIr["semantic_residual"][number][] = [];
  for (const [claimId, effect] of effects) {
    const claim = claimById.get(claimId);
    if (claim === undefined) continue;
    const bindings = uniqueBindings(claim, catalog);
    const axis = effect === "uses" ? "requirement_delta" : "domain_preservation";
    if (bindings.length === 0) {
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
      observation_bindings: bindings,
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
      claim.observation_bindings.map((binding) => binding.behavior_id),
    ]),
  );
  const behaviorToClaims = Object.fromEntries(
    LEDGER_BEHAVIORS.map((behavior) => [
      behavior,
      deterministicClaims
        .filter((claim) =>
          claim.observation_bindings.some((binding) => binding.behavior_id === behavior),
        )
        .map((claim) => claim.claim_id),
    ]),
  );
  const claimIr = parseClaimIr({
    schema_version: 1,
    compiler: { compiler_id: "phase3b-deterministic-compiler", compiler_version: 1 },
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
  const oraclePlan = rebuildOraclePlan({ claimIr, catalog });
  return { claimIr, oraclePlan };
}
