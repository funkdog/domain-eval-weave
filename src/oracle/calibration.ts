import { cp, mkdir } from "node:fs/promises";

import type { BehaviorVector, LedgerBehavior, LedgerOracle } from "./ledger.js";

function statuses(vector: BehaviorVector): readonly string[] {
  return Object.values(vector);
}

function failures(vector: BehaviorVector): readonly LedgerBehavior[] {
  return Object.entries(vector)
    .filter(([, status]) => status !== "pass")
    .map(([behavior]) => behavior as LedgerBehavior);
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

export async function calibrateLedgerPack(input: {
  readonly oracle: LedgerOracle;
  readonly packRoot: string;
  readonly scratchRoot: string;
  readonly seed: number;
}): Promise<CalibrationResult> {
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
  const [
    red,
    gold,
    noLock,
    noPersistence,
    corruptResets,
    brokenRelease,
    releaseNotPersisted,
    repeatedGold,
    nextSeedGold,
  ] = await Promise.all([
    evaluate("base", "red"),
    evaluate("calibration/gold-equivalent", "gold"),
    evaluate("calibration/mutant-no-lock", "no-lock"),
    evaluate("calibration/mutant-no-persistence", "no-persistence"),
    evaluate("calibration/mutant-corrupt-resets", "corrupt-resets"),
    evaluate("calibration/mutant-broken-release", "broken-release"),
    evaluate("calibration/mutant-release-not-persisted", "release-not-persisted"),
    evaluate("calibration/gold-equivalent", "gold-repeat"),
    evaluate("calibration/gold-equivalent", "gold-next-seed", input.seed + 1),
  ]);
  const noLockFailures = failures(noLock);
  const noPersistenceFailures = failures(noPersistence);
  const corruptResetsFailures = failures(corruptResets);
  const brokenReleaseFailures = failures(brokenRelease);
  const releaseNotPersistedFailures = failures(releaseNotPersisted);
  const repeatable =
    input.oracle.canonicalVector(gold) === input.oracle.canonicalVector(repeatedGold);
  const seedStable = JSON.stringify(statuses(gold)) === JSON.stringify(statuses(nextSeedGold));
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
