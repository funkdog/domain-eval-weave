import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";
import { canonicalJson, canonicalJsonDigest } from "../canonical-json.js";
import { writeExclusiveOrVerify } from "../capsule/artifact-store.js";
import type { EvaluationRun } from "../capsule/contracts.js";
import type { LoadedCapsule } from "../capsule/loader.js";
import { CapsuleError, evaluatorReference, findEvaluator } from "../capsule/loader.js";
import type { ReleasedCapsule } from "../capsule/release.js";
import { type CandidateRunner, SandboxedCommandRunner } from "./command-runner.js";
import { evaluateCandidate } from "./engine.js";

export interface CalibrationReport {
  readonly schema_version: 1;
  readonly capsule_release_sha256: string;
  readonly evaluator: { readonly evaluator_id: string; readonly version: string };
  readonly qualified: boolean;
  readonly diagnostics: readonly string[];
  readonly failed_case_ids: readonly string[];
  readonly cases: readonly {
    readonly case_id: string;
    readonly kind: "gold" | "equivalent" | "mutant";
    readonly matched: boolean;
    readonly mismatches: readonly {
      readonly claim_id: string;
      readonly expected: EvaluationRun["claims"][number]["status"];
      readonly actual: EvaluationRun["claims"][number]["status"] | "missing";
    }[];
  }[];
}

const claimStatusSchema = z.enum(["pass", "fail", "inconclusive", "measurement_error"]);
const calibrationReportSchema = z.strictObject({
  schema_version: z.literal(1),
  capsule_release_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  evaluator: z.strictObject({ evaluator_id: z.string().min(1), version: z.string().min(1) }),
  qualified: z.boolean(),
  diagnostics: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  failed_case_ids: z.array(z.string().min(1)),
  cases: z.array(
    z.strictObject({
      case_id: z.string().min(1),
      kind: z.enum(["gold", "equivalent", "mutant"]),
      matched: z.boolean(),
      mismatches: z.array(
        z.strictObject({
          claim_id: z.string().min(1),
          expected: claimStatusSchema,
          actual: z.union([claimStatusSchema, z.literal("missing")]),
        }),
      ),
    }),
  ),
});

export interface PersistedCalibrationReport {
  readonly report: CalibrationReport;
  readonly sha256: string;
  readonly ref: string;
}

export async function calibrateEvaluator(input: {
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly evaluatorRef: string;
  readonly runner?: CandidateRunner;
}): Promise<CalibrationReport> {
  const evaluator = findEvaluator(input.capsule, input.evaluatorRef);
  const results = [];
  for (const calibrationCase of input.capsule.cases) {
    const evaluated = await evaluateCandidate({
      capsule: input.capsule,
      release: input.release,
      evaluatorRef: input.evaluatorRef,
      requirementId: evaluator.requirement_id,
      candidateId: calibrationCase.candidate_id,
      ...(input.runner === undefined ? {} : { runner: input.runner }),
      persist: false,
    });
    const actual = new Map(evaluated.run.claims.map((claim) => [claim.claim_id, claim.status]));
    const mismatches: {
      claim_id: string;
      expected: EvaluationRun["claims"][number]["status"];
      actual: EvaluationRun["claims"][number]["status"] | "missing";
    }[] = calibrationCase.expected_claims.flatMap((expected) => {
      const status: EvaluationRun["claims"][number]["status"] | "missing" =
        actual.get(expected.claim_id) ?? "missing";
      return status === expected.status
        ? []
        : [{ claim_id: expected.claim_id, expected: expected.status, actual: status }];
    });
    for (const target of calibrationCase.target_claim_ids ?? []) {
      if (actual.get(target) !== "fail" && !mismatches.some((entry) => entry.claim_id === target)) {
        mismatches.push({
          claim_id: target,
          expected: "fail",
          actual: actual.get(target) ?? "missing",
        });
      }
    }
    results.push({
      case_id: calibrationCase.case_id,
      kind: calibrationCase.kind,
      matched: mismatches.length === 0,
      mismatches,
    });
  }
  const failedCaseIds = results
    .filter((result) => !result.matched)
    .map((result) => result.case_id)
    .sort();
  const kinds = new Set(input.capsule.cases.map((entry) => entry.kind));
  const diagnostics = [
    ...(!kinds.has("gold") ? ["CALIBRATION_GOLD_MISSING"] : []),
    ...(!kinds.has("equivalent") ? ["CALIBRATION_EQUIVALENT_MISSING"] : []),
    ...(!kinds.has("mutant") ? ["CALIBRATION_MUTANT_MISSING"] : []),
  ];
  return calibrationReportSchema.parse({
    schema_version: 1,
    capsule_release_sha256: input.release.sha256,
    evaluator: { evaluator_id: evaluator.evaluator_id, version: evaluator.version },
    qualified: failedCaseIds.length === 0 && diagnostics.length === 0,
    diagnostics,
    failed_case_ids: failedCaseIds,
    cases: results,
  });
}

export async function persistCalibrationReport(
  root: string,
  reportInput: CalibrationReport,
): Promise<PersistedCalibrationReport> {
  const report = calibrationReportSchema.parse(reportInput);
  const sha256 = canonicalJsonDigest(report);
  const ref = `.eval/calibrations/${sha256}.json`;
  await mkdir(resolve(root, ".eval/calibrations"), { recursive: true, mode: 0o700 });
  const path = resolve(root, ref);
  await writeExclusiveOrVerify(
    path,
    Buffer.from(`${canonicalJson(report)}\n`, "utf8"),
    () =>
      new CapsuleError(
        "CAPSULE_CALIBRATION_COLLISION",
        "Existing calibration path contains different bytes",
        path,
      ),
  );
  return { report, sha256, ref };
}

export async function calibrateAndPersistEvaluator(
  input: Parameters<typeof calibrateEvaluator>[0],
): Promise<PersistedCalibrationReport> {
  return persistCalibrationReport(input.capsule.root, await calibrateEvaluator(input));
}

export async function readCalibrationReport(root: string, ref: string): Promise<CalibrationReport> {
  if (!/^\.eval\/calibrations\/[0-9a-f]{64}\.json$/.test(ref)) {
    throw new CapsuleError("CAPSULE_CALIBRATION_REF_INVALID", "Calibration ref is invalid", ref);
  }
  const report = calibrationReportSchema.parse(
    JSON.parse(await readFile(resolve(root, ref), "utf8")),
  );
  const expected = ref.slice(".eval/calibrations/".length, -".json".length);
  if (canonicalJsonDigest(report) !== expected) {
    throw new CapsuleError("CAPSULE_CALIBRATION_DRIFT", "Calibration digest drifted", ref);
  }
  return report;
}

export async function findCalibrationReports(input: {
  readonly capsule: LoadedCapsule;
  readonly releaseSha256: string;
  readonly evaluatorRef?: string;
}): Promise<readonly PersistedCalibrationReport[]> {
  const directory = resolve(input.capsule.root, ".eval/calibrations");
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const reports: PersistedCalibrationReport[] = [];
  for (const name of names.filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry)).sort()) {
    const ref = `.eval/calibrations/${name}`;
    const report = await readCalibrationReport(input.capsule.root, ref);
    if (
      report.capsule_release_sha256 === input.releaseSha256 &&
      (input.evaluatorRef === undefined ||
        evaluatorReference(report.evaluator) === input.evaluatorRef)
    ) {
      reports.push({ report, sha256: name.slice(0, -5), ref });
    }
  }
  return reports;
}

export interface EvaluatorComparison {
  readonly left: string;
  readonly right: string;
  readonly changed_cases: readonly {
    readonly case_id: string;
    readonly claim_changes: readonly {
      readonly claim_id: string;
      readonly left: EvaluationRun["claims"][number]["status"];
      readonly right: EvaluationRun["claims"][number]["status"];
    }[];
  }[];
}

export async function compareEvaluators(input: {
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly requirementId: string;
  readonly leftEvaluatorRef: string;
  readonly rightEvaluatorRef: string;
  readonly runner?: CandidateRunner;
}): Promise<EvaluatorComparison> {
  const changedCases = [];
  for (const calibrationCase of input.capsule.cases) {
    const delegate = input.runner ?? new SandboxedCommandRunner();
    let sharedExecution: ReturnType<CandidateRunner["run"]> | undefined;
    const sharedRunner: CandidateRunner = {
      run(request) {
        sharedExecution ??= Promise.resolve().then(() => delegate.run(request));
        return sharedExecution;
      },
    };
    const [left, right] = await Promise.all(
      [input.leftEvaluatorRef, input.rightEvaluatorRef].map((evaluatorRef) =>
        evaluateCandidate({
          capsule: input.capsule,
          release: input.release,
          evaluatorRef,
          requirementId: input.requirementId,
          candidateId: calibrationCase.candidate_id,
          runner: sharedRunner,
          persist: false,
        }),
      ),
    );
    const rightByClaim = new Map(right?.run.claims.map((claim) => [claim.claim_id, claim.status]));
    const claimChanges = (left?.run.claims ?? []).flatMap((claim) => {
      const rightStatus = rightByClaim.get(claim.claim_id);
      return rightStatus === undefined || rightStatus === claim.status
        ? []
        : [{ claim_id: claim.claim_id, left: claim.status, right: rightStatus }];
    });
    if (claimChanges.length > 0) {
      changedCases.push({ case_id: calibrationCase.case_id, claim_changes: claimChanges });
    }
  }
  return {
    left: input.leftEvaluatorRef,
    right: input.rightEvaluatorRef,
    changed_cases: changedCases,
  };
}
