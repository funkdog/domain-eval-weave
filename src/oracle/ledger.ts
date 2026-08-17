import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "../contracts/canonical-json.js";
import type { StrictProcessRunner } from "../process/strict-runner.js";
import { extractCandidateArchive } from "./archive.js";

export const LEDGER_BEHAVIORS = [
  "basic_reservation",
  "idempotent_replay",
  "conflicting_replay_rejected",
  "no_oversubscription_concurrent",
  "terminal_transition_idempotency",
  "restart_recovery",
  "corrupt_state_fail_closed",
  "deterministic_snapshot",
] as const;

export type LedgerBehavior = (typeof LEDGER_BEHAVIORS)[number];
export type BehaviorStatus = "pass" | "fail" | "error";
export type BehaviorVector = Readonly<Record<LedgerBehavior, BehaviorStatus>>;

export class LedgerOracle {
  readonly #runner: StrictProcessRunner;
  readonly #oracleRunnerPath: string;

  constructor(input: { readonly runner: StrictProcessRunner; readonly oracleRunnerPath: string }) {
    this.#runner = input.runner;
    this.#oracleRunnerPath = resolve(input.oracleRunnerPath);
  }

  async evaluateDirectory(
    candidateRoot: string,
    seed: number,
    scratchRoot: string,
  ): Promise<BehaviorVector> {
    if (!Number.isSafeInteger(seed) || seed < 0)
      throw new Error("Oracle seed must be non-negative");
    await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    const oracleSource = await readFile(this.#oracleRunnerPath, "utf8");
    const result = await this.#runner.run({
      executable: process.execPath,
      args: [
        "--input-type=module",
        "-",
        "--candidate",
        resolve(candidateRoot),
        "--scratch",
        resolve(scratchRoot),
        "--seed",
        String(seed),
      ],
      cwd: resolve(candidateRoot),
      readableRoots: [resolve(candidateRoot)],
      writableRoot: resolve(scratchRoot),
      timeoutMs: 40_000,
      maxOutputBytes: 65_536,
      stdin: oracleSource,
    });
    const errors = () =>
      Object.fromEntries(LEDGER_BEHAVIORS.map((behavior) => [behavior, "error"])) as BehaviorVector;
    if (result.timedOut || result.outputLimitExceeded || result.exitCode !== 0) return errors();
    try {
      const parsed = JSON.parse(result.stdout) as { schema_version?: unknown; behavior?: unknown };
      if (
        parsed.schema_version !== 1 ||
        typeof parsed.behavior !== "object" ||
        parsed.behavior === null ||
        Array.isArray(parsed.behavior)
      ) {
        return errors();
      }
      const behavior = parsed.behavior as Record<string, unknown>;
      if (
        Object.keys(behavior).length !== LEDGER_BEHAVIORS.length ||
        LEDGER_BEHAVIORS.some((name) => behavior[name] !== "pass" && behavior[name] !== "fail")
      ) {
        return errors();
      }
      return Object.fromEntries(
        LEDGER_BEHAVIORS.map((name) => [name, behavior[name]]),
      ) as BehaviorVector;
    } catch {
      return errors();
    }
  }

  async evaluateArchive(
    archivePath: string,
    seed: number,
    scratchRoot: string,
  ): Promise<BehaviorVector> {
    const candidateRoot = resolve(scratchRoot, "candidate");
    await extractCandidateArchive(archivePath, candidateRoot);
    return this.evaluateDirectory(candidateRoot, seed, resolve(scratchRoot, "checks"));
  }

  canonicalVector(vector: BehaviorVector): string {
    return canonicalJson(vector);
  }
}
