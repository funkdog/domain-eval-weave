import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "../contracts/canonical-json.js";
import type { StrictProcessRunner } from "../process/strict-runner.js";
import { extractCandidateArchive } from "./archive.js";
import type { BehaviorStatus } from "./ledger.js";

export const COMMERCE_BEHAVIORS = [
  "unpaid_cancel_has_no_refund",
  "paid_unshipped_creates_paid_amount_refund",
  "shipped_order_requires_after_sales",
  "cancellation_and_refund_states_are_separate",
  "inventory_release_is_exactly_once",
  "coupon_restore_requires_current_eligibility",
  "customer_ownership_is_enforced",
  "restart_recovery_preserves_idempotency_and_audit",
] as const;

export type CommerceBehavior = (typeof COMMERCE_BEHAVIORS)[number];
export type CommerceBehaviorVector = Readonly<Record<CommerceBehavior, BehaviorStatus>>;

export class CommerceOrderOracle {
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
  ): Promise<CommerceBehaviorVector> {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new Error("Oracle seed must be non-negative");
    }
    await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    const oracleSource = await readFile(this.#oracleRunnerPath, "utf8");
    const entries = await Promise.all(
      COMMERCE_BEHAVIORS.map(
        async (behavior, index): Promise<readonly [CommerceBehavior, BehaviorStatus]> => {
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
          if (result.timedOut || result.outputLimitExceeded || result.exitCode !== 0) {
            return [behavior, "error"];
          }
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
    return Object.fromEntries(entries) as CommerceBehaviorVector;
  }

  async evaluateArchive(
    archivePath: string,
    seed: number,
    scratchRoot: string,
  ): Promise<CommerceBehaviorVector> {
    const candidateRoot = resolve(scratchRoot, "candidate");
    await extractCandidateArchive(archivePath, candidateRoot);
    return this.evaluateDirectory(candidateRoot, seed, resolve(scratchRoot, "checks"));
  }

  canonicalVector(vector: CommerceBehaviorVector): string {
    return canonicalJson(vector);
  }
}
