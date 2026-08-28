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
  readonly #timeoutMsPerBehavior: number;

  constructor(input: {
    readonly runner: StrictProcessRunner;
    readonly oracleRunnerPath: string;
    readonly timeoutMsPerBehavior?: number;
  }) {
    this.#runner = input.runner;
    this.#oracleRunnerPath = resolve(input.oracleRunnerPath);
    this.#timeoutMsPerBehavior = input.timeoutMsPerBehavior ?? 5_000;
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
    const entries = await Promise.all(
      LEDGER_BEHAVIORS.map(
        async (behavior, index): Promise<readonly [LedgerBehavior, BehaviorStatus]> => {
          const behaviorScratch = resolve(scratchRoot, `case-${index}`);
          await mkdir(behaviorScratch, { recursive: true, mode: 0o700 });
          const result = await this.#runner.run({
            executable: process.execPath,
            args: [
              "--input-type=module",
              "-",
              "--candidate",
              resolve(candidateRoot),
              "--scratch",
              behaviorScratch,
              "--seed",
              String(seed),
              "--behavior",
              behavior,
              "--timeout-ms",
              String(this.#timeoutMsPerBehavior),
            ],
            cwd: resolve(candidateRoot),
            readableRoots: [resolve(candidateRoot)],
            writableRoot: behaviorScratch,
            timeoutMs: this.#timeoutMsPerBehavior + 1_000,
            maxOutputBytes: 4_096,
            stdin: oracleSource,
          });
          if (result.timedOut) return [behavior, "error"];
          if (result.outputLimitExceeded || result.exitCode !== 0) return [behavior, "error"];
          try {
            const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
            if (
              Object.keys(parsed).sort().join(",") !== "behavior,schema_version,status" ||
              parsed.schema_version !== 1 ||
              parsed.behavior !== behavior ||
              (parsed.status !== "pass" && parsed.status !== "fail")
            ) {
              return [behavior, "error"];
            }
            return [behavior, parsed.status];
          } catch {
            return [behavior, "error"];
          }
        },
      ),
    );
    return Object.fromEntries(entries) as BehaviorVector;
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
