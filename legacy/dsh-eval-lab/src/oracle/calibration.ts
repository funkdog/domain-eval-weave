import { cp, mkdir } from "node:fs/promises";

import {
  type BehaviorVector,
  LEDGER_BEHAVIORS,
  type LedgerBehavior,
  type LedgerOracle,
} from "./ledger.js";

export const DETAILED_CALIBRATION_CANDIDATES = [
  "red",
  "gold",
  "mutant-no-lock",
  "mutant-no-persistence",
  "mutant-corrupt-resets",
  "mutant-broken-release",
  "mutant-release-not-persisted",
  "gold-repeat",
  "gold-next-seed",
] as const;

export type DetailedCalibrationCandidate = (typeof DETAILED_CALIBRATION_CANDIDATES)[number];

export interface DetailedCalibrationEvidence {
  readonly schema_version: 1;
  readonly vectors: Readonly<Record<DetailedCalibrationCandidate, BehaviorVector>>;
}

function statuses(vector: BehaviorVector): readonly string[] {
  return LEDGER_BEHAVIORS.map((behavior) => vector[behavior]);
}

function failures(vector: BehaviorVector): readonly LedgerBehavior[] {
  return LEDGER_BEHAVIORS.filter((behavior) => vector[behavior] !== "pass");
}

export interface CalibrationResult {
  readonly schema_version: 1;
  readonly ready: boolean;
  readonly candidates: {
    readonly red: readonly string[];
    readonly gold: readonly string[];
    readonly no_lock_failures: readonly LedgerBehavior[];
    readonly no_persistence_failures: readonly LedgerBehavior[];
    readonly corrupt_resets_failures: readonly LedgerBehavior[];
    readonly broken_release_failures: readonly LedgerBehavior[];
    readonly release_not_persisted_failures: readonly LedgerBehavior[];
  };
  readonly repeatable: boolean;
  readonly seed_stable: boolean;
}

async function evaluateCalibrationVectors(input: {
  readonly oracle: LedgerOracle;
  readonly packRoot: string;
  readonly scratchRoot: string;
  readonly seed: number;
}): Promise<DetailedCalibrationEvidence["vectors"]> {
  const evaluate = async (relativePath: string, suffix: string, seed = input.seed) => {
    const candidateRoot = `${input.scratchRoot}/candidates/${suffix}`;
    await mkdir(`${input.scratchRoot}/candidates`, { recursive: true, mode: 0o700 });
    await cp(`${input.packRoot}/${relativePath}`, candidateRoot, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return input.oracle.evaluateDirectory(
      candidateRoot,
      seed,
      `${input.scratchRoot}/checks/${suffix}`,
    );
  };
  const red = await evaluate("base", "red");
  const gold = await evaluate("calibration/gold-equivalent", "gold");
  const noLock = await evaluate("calibration/mutant-no-lock", "mutant-no-lock");
  const noPersistence = await evaluate(
    "calibration/mutant-no-persistence",
    "mutant-no-persistence",
  );
  const corruptResets = await evaluate(
    "calibration/mutant-corrupt-resets",
    "mutant-corrupt-resets",
  );
  const brokenRelease = await evaluate(
    "calibration/mutant-broken-release",
    "mutant-broken-release",
  );
  const releaseNotPersisted = await evaluate(
    "calibration/mutant-release-not-persisted",
    "mutant-release-not-persisted",
  );
  const repeatedGold = await evaluate("calibration/gold-equivalent", "gold-repeat");
  const nextSeedGold = await evaluate(
    "calibration/gold-equivalent",
    "gold-next-seed",
    input.seed + 1,
  );
  return {
    red,
    gold,
    "mutant-no-lock": noLock,
    "mutant-no-persistence": noPersistence,
    "mutant-corrupt-resets": corruptResets,
    "mutant-broken-release": brokenRelease,
    "mutant-release-not-persisted": releaseNotPersisted,
    "gold-repeat": repeatedGold,
    "gold-next-seed": nextSeedGold,
  };
}

export async function calibrateLedgerPackDetailed(input: {
  readonly oracle: LedgerOracle;
  readonly packRoot: string;
  readonly scratchRoot: string;
  readonly seed: number;
}): Promise<DetailedCalibrationEvidence> {
  const vectors = await evaluateCalibrationVectors(input);
  return {
    schema_version: 1,
    vectors,
  };
}

export async function calibrateLedgerPack(input: {
  readonly oracle: LedgerOracle;
  readonly packRoot: string;
  readonly scratchRoot: string;
  readonly seed: number;
}): Promise<CalibrationResult> {
  const detailed = await calibrateLedgerPackDetailed(input);
  return projectCalibrationResult(detailed);
}

export function projectCalibrationResult(detailed: DetailedCalibrationEvidence): CalibrationResult {
  const red = detailed.vectors.red;
  const gold = detailed.vectors.gold;
  const noLock = detailed.vectors["mutant-no-lock"];
  const noPersistence = detailed.vectors["mutant-no-persistence"];
  const corruptResets = detailed.vectors["mutant-corrupt-resets"];
  const brokenRelease = detailed.vectors["mutant-broken-release"];
  const releaseNotPersisted = detailed.vectors["mutant-release-not-persisted"];
  const noLockFailures = failures(noLock);
  const noPersistenceFailures = failures(noPersistence);
  const corruptResetsFailures = failures(corruptResets);
  const brokenReleaseFailures = failures(brokenRelease);
  const releaseNotPersistedFailures = failures(releaseNotPersisted);
  const repeatable =
    JSON.stringify(statuses(gold)) === JSON.stringify(statuses(detailed.vectors["gold-repeat"]));
  const seedStable =
    JSON.stringify(statuses(gold)) === JSON.stringify(statuses(detailed.vectors["gold-next-seed"]));
  const ready =
    failures(red).length > 0 &&
    failures(gold).length === 0 &&
    JSON.stringify(noLockFailures) === JSON.stringify(["no_oversubscription_concurrent"]) &&
    JSON.stringify(noPersistenceFailures) === JSON.stringify(["restart_recovery"]) &&
    JSON.stringify(corruptResetsFailures) === JSON.stringify(["corrupt_state_fail_closed"]) &&
    JSON.stringify(brokenReleaseFailures) ===
      JSON.stringify(["terminal_transition_idempotency", "restart_recovery"]) &&
    JSON.stringify(releaseNotPersistedFailures) === JSON.stringify(["restart_recovery"]) &&
    repeatable &&
    seedStable;
  return {
    schema_version: 1,
    ready,
    candidates: {
      red: statuses(red),
      gold: statuses(gold),
      no_lock_failures: noLockFailures,
      no_persistence_failures: noPersistenceFailures,
      corrupt_resets_failures: corruptResetsFailures,
      broken_release_failures: brokenReleaseFailures,
      release_not_persisted_failures: releaseNotPersistedFailures,
    },
    repeatable,
    seed_stable: seedStable,
  };
}
