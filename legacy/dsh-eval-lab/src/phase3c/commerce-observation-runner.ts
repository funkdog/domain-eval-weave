import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { writeCanonicalJsonArtifact } from "../contracts/artifacts.js";
import { canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { extractCandidateArchive } from "../oracle/archive.js";
import type { StrictProcessRunner } from "../process/strict-runner.js";
import { PHASE3C_SCENARIOS } from "./compiler.js";
import {
  domainObservationNormalFormSchema,
  type ObservationBoundarySpec,
  type Phase3cArtifactPointer,
} from "./contracts.js";
import type { ObservationContext } from "./observation.js";
import type {
  ObservationExecutionEvidence,
  ObservationExecutionFailureEvidence,
  ObservationExecutor,
} from "./observation-runner.js";
import {
  PHASE3C_NORMAL_FORM_SLOTS,
  PHASE3C_OPERATIONS,
  PHASE3C_STIMULI,
  PHASE3C_STIMULUS_FIELDS,
} from "./vocabulary.js";

const scalarSchema = z.union([z.string(), z.number().int(), z.boolean(), z.null()]);
const contextSchema = z.strictObject({
  schema_version: z.literal(1),
  scenario: z.enum(PHASE3C_SCENARIOS.map((entry) => entry.scenarioId) as [string, ...string[]]),
  operations: z.partialRecord(
    z.enum(PHASE3C_OPERATIONS),
    z.enum(["accepted", "rejected", "unavailable"]),
  ),
  normal_forms: z.partialRecord(
    z.enum(PHASE3C_NORMAL_FORM_SLOTS),
    domainObservationNormalFormSchema,
  ),
  stimuli: z.partialRecord(
    z.enum(PHASE3C_STIMULI),
    z.partialRecord(z.enum(PHASE3C_STIMULUS_FIELDS), scalarSchema),
  ),
  retention_age_ms: z.partialRecord(z.literal("retention_clock"), z.number().int().nonnegative()),
});

interface ScenarioEvidence {
  readonly context: ObservationContext;
  readonly contextPointer: Phase3cArtifactPointer;
  readonly receiptPointer: Phase3cArtifactPointer;
}

class ScenarioExecutionError extends Error {
  constructor(readonly evidence: Phase3cArtifactPointer) {
    super("Commerce observation scenario failed");
    this.name = "ScenarioExecutionError";
  }
}

function scenarioForBinding(binding: ObservationBoundarySpec["bindings"][number]) {
  const scenario = PHASE3C_SCENARIOS.find((entry) =>
    binding.observation_id.startsWith(`${entry.scenarioId}-`),
  );
  if (scenario === undefined)
    throw new Error("Observation binding has no frozen Commerce scenario");
  return scenario;
}

export class CommerceObservationExecutor implements ObservationExecutor {
  readonly #runner: StrictProcessRunner;
  readonly #runnerPath: string;
  readonly #runnerSha256: string;
  readonly #candidateRoot: string;
  readonly #scratchRoot: string;
  readonly #campaignRoot: string;
  readonly #seed: number;
  readonly #timeoutMs: number;
  readonly #cache = new Map<string, Promise<ScenarioEvidence>>();

  constructor(input: {
    readonly runner: StrictProcessRunner;
    readonly runnerPath: string;
    readonly runnerSha256: string;
    readonly candidateRoot: string;
    readonly scratchRoot: string;
    readonly campaignRoot: string;
    readonly seed: number;
    readonly timeoutMsPerScenario?: number;
  }) {
    this.#runner = input.runner;
    this.#runnerPath = resolve(input.runnerPath);
    this.#runnerSha256 = input.runnerSha256;
    this.#candidateRoot = resolve(input.candidateRoot);
    this.#scratchRoot = resolve(input.scratchRoot);
    this.#campaignRoot = resolve(input.campaignRoot);
    this.#seed = input.seed;
    this.#timeoutMs = input.timeoutMsPerScenario ?? 10_000;
  }

  async #executeScenario(scenarioId: string): Promise<ScenarioEvidence> {
    const runnerSource = await readFile(this.#runnerPath, "utf8");
    if (sha256Hex(runnerSource) !== this.#runnerSha256) {
      throw new Error("Commerce observation runner bytes drifted");
    }
    const scratch = resolve(this.#scratchRoot, scenarioId);
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    const terminal = await this.#runner.run({
      executable: process.execPath,
      args: [
        "--input-type=module",
        "-",
        "--candidate",
        this.#candidateRoot,
        "--scratch",
        scratch,
        "--seed",
        String(this.#seed),
        "--scenario",
        scenarioId,
        "--timeout-ms",
        String(this.#timeoutMs),
      ],
      cwd: this.#candidateRoot,
      readableRoots: [this.#candidateRoot],
      writableRoot: scratch,
      timeoutMs: this.#timeoutMs + 1_000,
      maxOutputBytes: 256 * 1024,
      stdin: runnerSource,
    });
    const receipt = {
      schema_version: 1,
      scenario_id: scenarioId,
      runner_sha256: this.#runnerSha256,
      seed: this.#seed,
      exit_code: terminal.exitCode,
      signal: terminal.signal,
      timed_out: terminal.timedOut,
      output_limit_exceeded: terminal.outputLimitExceeded,
      stdout_sha256: sha256Hex(terminal.stdout),
      stderr_sha256: sha256Hex(terminal.stderr),
    };
    const receiptPointer = await writeCanonicalJsonArtifact(
      this.#campaignRoot,
      `artifact://campaign/phase3c/deterministic-results/scenarios/${scenarioId}/receipt.json`,
      receipt,
    );
    if (
      terminal.exitCode !== 0 ||
      terminal.signal !== null ||
      terminal.timedOut ||
      terminal.outputLimitExceeded
    ) {
      throw new ScenarioExecutionError(receiptPointer);
    }
    let parsed: z.infer<typeof contextSchema>;
    try {
      parsed = contextSchema.parse(JSON.parse(terminal.stdout));
    } catch {
      throw new ScenarioExecutionError(receiptPointer);
    }
    if (parsed.scenario !== scenarioId) throw new ScenarioExecutionError(receiptPointer);
    const contextPointer = await writeCanonicalJsonArtifact(
      this.#campaignRoot,
      `artifact://campaign/phase3c/deterministic-results/scenarios/${scenarioId}/normal-form-context.json`,
      parsed,
    );
    const context: ObservationContext = {
      operations: parsed.operations,
      normalForms: parsed.normal_forms,
      stimuli: parsed.stimuli,
      retentionAgeMs: parsed.retention_age_ms,
    };
    if (canonicalJsonDigest(parsed) !== contextPointer.sha256) {
      throw new ScenarioExecutionError(receiptPointer);
    }
    return { context, contextPointer, receiptPointer };
  }

  execute(
    binding: ObservationBoundarySpec["bindings"][number],
  ): Promise<ObservationExecutionEvidence> {
    const scenario = scenarioForBinding(binding);
    let pending = this.#cache.get(scenario.scenarioId);
    if (pending === undefined) {
      pending = this.#executeScenario(scenario.scenarioId);
      this.#cache.set(scenario.scenarioId, pending);
    }
    return pending.then((evidence) => ({
      context: evidence.context,
      normalFormRef: evidence.contextPointer,
      evidenceRefs: [evidence.receiptPointer],
    }));
  }

  async captureFailure(
    binding: ObservationBoundarySpec["bindings"][number],
    error: unknown,
  ): Promise<ObservationExecutionFailureEvidence> {
    if (error instanceof ScenarioExecutionError) return { evidenceRefs: [error.evidence] };
    const scenario = scenarioForBinding(binding);
    const pointer = await writeCanonicalJsonArtifact(
      this.#campaignRoot,
      `artifact://campaign/phase3c/deterministic-results/scenarios/${scenario.scenarioId}/failure.json`,
      {
        schema_version: 1,
        scenario_id: scenario.scenarioId,
        diagnostic_code: "OBSERVATION_EXECUTION_FAILED",
      },
    );
    return { evidenceRefs: [pointer] };
  }
}

export async function createCommerceObservationExecutorForArchive(input: {
  readonly runner: StrictProcessRunner;
  readonly runnerPath: string;
  readonly runnerSha256: string;
  readonly archivePath: string;
  readonly scratchRoot: string;
  readonly campaignRoot: string;
  readonly seed: number;
}): Promise<CommerceObservationExecutor> {
  const candidateRoot = resolve(input.scratchRoot, "candidate");
  await extractCandidateArchive(input.archivePath, candidateRoot);
  return new CommerceObservationExecutor({
    runner: input.runner,
    runnerPath: input.runnerPath,
    runnerSha256: input.runnerSha256,
    candidateRoot,
    scratchRoot: resolve(input.scratchRoot, "scenarios"),
    campaignRoot: input.campaignRoot,
    seed: input.seed,
  });
}
