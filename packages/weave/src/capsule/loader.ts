import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { parse, stringify } from "yaml";

import { canonicalJsonDigest } from "../canonical-json.js";
import {
  type CalibrationCase,
  type CapsuleDomain,
  type CapsuleManifest,
  claimConfirmationProjection,
  type EvaluatorPackage,
  parseCalibrationCase,
  parseCapsuleDomain,
  parseCapsuleManifest,
  parseEvaluatorPackage,
  parseRequirementDelta,
  type RequirementDelta,
} from "./contracts.js";

export class CapsuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly locator?: string,
  ) {
    super(locator === undefined ? message : `${message} (${locator})`);
    this.name = "CapsuleError";
  }
}

export interface LoadedCapsule {
  readonly root: string;
  readonly manifest: CapsuleManifest;
  readonly domain: CapsuleDomain;
  readonly requirements: readonly RequirementDelta[];
  readonly evaluators: readonly EvaluatorPackage[];
  readonly cases: readonly CalibrationCase[];
  readonly paths: {
    readonly manifest: string;
    readonly domain: string;
    readonly requirements: readonly string[];
    readonly evaluators: readonly string[];
    readonly cases: readonly string[];
  };
}

function inside(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
}

async function assertPhysicalPath(
  root: string,
  relativePath: string,
  expected: "file" | "directory",
) {
  const absolute = resolve(root, relativePath);
  if (!inside(root, absolute)) {
    throw new CapsuleError("CAPSULE_PATH_ESCAPE", "Capsule path escapes its root", relativePath);
  }
  const entry = await lstat(absolute).catch(() => undefined);
  if (entry === undefined) {
    throw new CapsuleError("CAPSULE_PATH_MISSING", "Capsule path does not exist", relativePath);
  }
  if (entry.isSymbolicLink()) {
    throw new CapsuleError(
      "CAPSULE_SYMLINK_DENIED",
      "Capsule paths cannot be symlinks",
      relativePath,
    );
  }
  if (
    (expected === "file" && !entry.isFile()) ||
    (expected === "directory" && !entry.isDirectory())
  ) {
    throw new CapsuleError(
      "CAPSULE_PATH_TYPE_INVALID",
      `Capsule path must be a ${expected}`,
      relativePath,
    );
  }
  const physical = await realpath(absolute);
  if (!inside(await realpath(root), physical)) {
    throw new CapsuleError(
      "CAPSULE_PATH_ESCAPE",
      "Capsule path resolves outside its root",
      relativePath,
    );
  }
  return absolute;
}

async function readStructured<T>(
  root: string,
  relativePath: string,
  parseValue: (input: unknown) => T,
): Promise<T> {
  const absolute = await assertPhysicalPath(root, relativePath, "file");
  let value: unknown;
  try {
    value = parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new CapsuleError(
      "CAPSULE_DOCUMENT_INVALID",
      error instanceof Error ? error.message : "Capsule document cannot be parsed",
      relativePath,
    );
  }
  try {
    return parseValue(value);
  } catch (error) {
    throw new CapsuleError(
      "CAPSULE_SCHEMA_INVALID",
      error instanceof Error ? error.message : "Capsule document does not match its schema",
      relativePath,
    );
  }
}

function validateSemantics(capsule: Omit<LoadedCapsule, "root">): void {
  const sources = new Set(capsule.manifest.sources.map((source) => source.source_id));
  const claims = new Map(capsule.domain.claims.map((claim) => [claim.claim_id, claim]));
  const requirements = new Map(
    capsule.requirements.map((requirement) => [requirement.requirement_id, requirement]),
  );
  const candidates = new Set(
    capsule.manifest.candidates.map((candidate) => candidate.candidate_id),
  );

  for (const claim of capsule.domain.claims) {
    for (const sourceId of claim.source_ids) {
      if (!sources.has(sourceId)) {
        throw new CapsuleError(
          "CAPSULE_SOURCE_UNKNOWN",
          `Claim ${claim.claim_id} references unknown source ${sourceId}`,
          capsule.paths.domain,
        );
      }
    }
    if (
      claim.confirmation !== undefined &&
      claim.confirmation.projection_sha256 !==
        canonicalJsonDigest(claimConfirmationProjection(claim))
    ) {
      throw new CapsuleError(
        "CAPSULE_CONFIRMATION_DRIFT",
        `Claim ${claim.claim_id} confirmation does not bind its current projection`,
        capsule.paths.domain,
      );
    }
  }

  for (const [index, requirement] of capsule.requirements.entries()) {
    for (const sourceId of requirement.source_ids) {
      if (!sources.has(sourceId)) {
        throw new CapsuleError(
          "CAPSULE_SOURCE_UNKNOWN",
          `Requirement ${requirement.requirement_id} references unknown source ${sourceId}`,
          capsule.paths.requirements[index],
        );
      }
    }
    for (const edge of requirement.edges) {
      if (!claims.has(edge.claim_id)) {
        throw new CapsuleError(
          "CAPSULE_CLAIM_UNKNOWN",
          `Requirement ${requirement.requirement_id} references unknown Claim ${edge.claim_id}`,
          capsule.paths.requirements[index],
        );
      }
    }
  }

  for (const [index, evaluator] of capsule.evaluators.entries()) {
    if (!requirements.has(evaluator.requirement_id)) {
      throw new CapsuleError(
        "CAPSULE_REQUIREMENT_UNKNOWN",
        `Evaluator ${evaluator.evaluator_id}@${evaluator.version} references unknown Requirement`,
        capsule.paths.evaluators[index],
      );
    }
    for (const check of evaluator.checks) {
      const claim = claims.get(check.claim_id);
      if (claim === undefined) {
        throw new CapsuleError(
          "CAPSULE_CLAIM_UNKNOWN",
          `Evaluator check ${check.check_id} references unknown Claim ${check.claim_id}`,
          capsule.paths.evaluators[index],
        );
      }
      if (claim.status !== "confirmed") {
        throw new CapsuleError(
          "CAPSULE_CLAIM_NOT_CONFIRMED",
          `Evaluator check ${check.check_id} cannot hard-judge ${claim.status} Claim ${claim.claim_id}`,
          capsule.paths.evaluators[index],
        );
      }
    }
  }

  for (const [index, calibrationCase] of capsule.cases.entries()) {
    if (!candidates.has(calibrationCase.candidate_id)) {
      throw new CapsuleError(
        "CAPSULE_CANDIDATE_UNKNOWN",
        `Calibration case ${calibrationCase.case_id} references unknown Candidate`,
        capsule.paths.cases[index],
      );
    }
    for (const expectation of calibrationCase.expected_claims) {
      if (!claims.has(expectation.claim_id)) {
        throw new CapsuleError(
          "CAPSULE_CLAIM_UNKNOWN",
          `Calibration case ${calibrationCase.case_id} references unknown Claim ${expectation.claim_id}`,
          capsule.paths.cases[index],
        );
      }
    }
    for (const target of calibrationCase.target_claim_ids ?? []) {
      if (!claims.has(target)) {
        throw new CapsuleError(
          "CAPSULE_CLAIM_UNKNOWN",
          `Mutant ${calibrationCase.case_id} targets unknown Claim ${target}`,
          capsule.paths.cases[index],
        );
      }
    }
  }
}

export async function loadCapsule(rootInput: string): Promise<LoadedCapsule> {
  const requestedRoot = resolve(rootInput);
  const rootEntry = await lstat(requestedRoot).catch(() => undefined);
  if (rootEntry === undefined || !rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new CapsuleError(
      "CAPSULE_ROOT_INVALID",
      "Capsule root must be a physical directory",
      requestedRoot,
    );
  }
  const root = await realpath(requestedRoot);
  const manifestPath = "capsule.yaml";
  const manifest = await readStructured(root, manifestPath, parseCapsuleManifest);
  const domain = await readStructured(root, manifest.domain, parseCapsuleDomain);
  const requirements = await Promise.all(
    manifest.requirements.map((path) => readStructured(root, path, parseRequirementDelta)),
  );
  const evaluators = await Promise.all(
    manifest.evaluators.map((path) => readStructured(root, path, parseEvaluatorPackage)),
  );
  const cases = await Promise.all(
    manifest.cases.map((path) => readStructured(root, path, parseCalibrationCase)),
  );
  for (const source of manifest.sources) await assertPhysicalPath(root, source.path, "file");
  for (const candidate of manifest.candidates) {
    await assertPhysicalPath(root, candidate.path, "directory");
  }
  const loaded: LoadedCapsule = {
    root,
    manifest,
    domain,
    requirements,
    evaluators,
    cases,
    paths: {
      manifest: manifestPath,
      domain: manifest.domain,
      requirements: manifest.requirements,
      evaluators: manifest.evaluators,
      cases: manifest.cases,
    },
  };
  validateSemantics(loaded);
  return loaded;
}

export async function confirmCapsuleClaim(input: {
  readonly root: string;
  readonly claimId: string;
  readonly ownerId: string;
}): Promise<CapsuleDomain["claims"][number]> {
  const capsule = await loadCapsule(input.root);
  const owner = capsule.domain.owners.find((entry) => entry.owner_id === input.ownerId);
  if (owner === undefined) {
    throw new CapsuleError(
      "CAPSULE_OWNER_UNKNOWN",
      `Owner ${input.ownerId} is not declared by the Capsule domain`,
      capsule.paths.domain,
    );
  }
  const claimIndex = capsule.domain.claims.findIndex((claim) => claim.claim_id === input.claimId);
  const claim = capsule.domain.claims[claimIndex];
  if (claim === undefined) {
    throw new CapsuleError(
      "CAPSULE_CLAIM_UNKNOWN",
      `Claim ${input.claimId} does not exist`,
      capsule.paths.domain,
    );
  }
  if (claim.status !== "proposed") {
    throw new CapsuleError(
      "CAPSULE_CLAIM_NOT_PROPOSED",
      `Only proposed Claims can be confirmed; ${input.claimId} is ${claim.status}`,
      capsule.paths.domain,
    );
  }
  const confirmed = parseCapsuleDomain({
    ...capsule.domain,
    claims: capsule.domain.claims.map((entry, index) =>
      index === claimIndex
        ? {
            ...entry,
            status: "confirmed",
            confirmation: {
              owner_id: input.ownerId,
              projection_sha256: canonicalJsonDigest(claimConfirmationProjection(entry)),
            },
          }
        : entry,
    ),
  });
  await writeFile(
    resolve(capsule.root, capsule.paths.domain),
    stringify(confirmed, { lineWidth: 0 }),
    "utf8",
  );
  return confirmed.claims[claimIndex] as CapsuleDomain["claims"][number];
}

export function evaluatorReference(evaluator: Pick<EvaluatorPackage, "evaluator_id" | "version">) {
  return `${evaluator.evaluator_id}@${evaluator.version}`;
}

export function findEvaluator(capsule: LoadedCapsule, ref: string): EvaluatorPackage {
  const evaluator = capsule.evaluators.find((entry) => evaluatorReference(entry) === ref);
  if (evaluator === undefined) {
    throw new CapsuleError("CAPSULE_EVALUATOR_UNKNOWN", `Evaluator ${ref} does not exist`);
  }
  return evaluator;
}

export function findRequirement(capsule: LoadedCapsule, requirementId: string): RequirementDelta {
  const requirement = capsule.requirements.find((entry) => entry.requirement_id === requirementId);
  if (requirement === undefined) {
    throw new CapsuleError(
      "CAPSULE_REQUIREMENT_UNKNOWN",
      `Requirement ${requirementId} does not exist`,
    );
  }
  return requirement;
}

export function findCandidate(capsule: LoadedCapsule, candidateId: string) {
  const candidate = capsule.manifest.candidates.find((entry) => entry.candidate_id === candidateId);
  if (candidate === undefined) {
    throw new CapsuleError("CAPSULE_CANDIDATE_UNKNOWN", `Candidate ${candidateId} does not exist`);
  }
  return candidate;
}
