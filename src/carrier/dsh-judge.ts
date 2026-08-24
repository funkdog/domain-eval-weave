import { readdir } from "node:fs/promises";
import { sha256Hex } from "../contracts/canonical-json.js";
import { PHASE3C_JUDGE } from "../instance.js";
import type { JudgeCarrier, JudgeCarrierResult } from "../phase3c/judge-runner.js";
import { decodeOfficialSessionJsonl } from "../projector/jsonl.js";
import { DshRunCarrier } from "./dsh-run.js";
import { discoverFreshSession } from "./session-discovery.js";
import { readStableSessionTranscript, scanRawSessionInventory } from "./session-inventory.js";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inventoryEntry(
  inventory: Awaited<ReturnType<typeof scanRawSessionInventory>>,
  sessionId: string,
) {
  const entry = inventory.find((candidate) => candidate.id === sessionId);
  if (entry === undefined) throw new Error("Judge Session transcript is missing");
  return entry;
}

function verifyJudgeSession(input: {
  readonly transcript: string;
  readonly workspace: string;
}): JudgeCarrierResult["observedModelRoute"] {
  const decoded = decodeOfficialSessionJsonl(input.transcript);
  if (
    decoded.header.version !== 0 ||
    decoded.header.cwd !== input.workspace ||
    decoded.header.parentSession !== undefined ||
    (decoded.header.delegationDepth ?? 0) !== 0
  ) {
    throw new Error("Judge Session header violates the isolated root contract");
  }
  if (
    decoded.events.some((event) => event.type === "tool/call" || event.type === "tool/result") ||
    !decoded.events.some((event) => event.type === "assistant/message") ||
    !decoded.events.some((event) => event.type === "turn/end")
  ) {
    throw new Error("Judge Session lifecycle or no-tools contract is invalid");
  }
  const routes = decoded.events
    .filter((event) => event.type === "request/header")
    .map((event) => {
      const header = record(record(event.data).header);
      const config = record(header.config);
      const tools = header.tools;
      if (!Array.isArray(tools) || tools.length !== 0) {
        throw new Error("Judge request exposed tools");
      }
      return {
        provider: config.provider,
        model: config.model,
        reasoning_effort: config.reasoningEffort,
      };
    });
  if (
    routes.length === 0 ||
    routes.some(
      (route) =>
        typeof route.provider !== "string" ||
        typeof route.model !== "string" ||
        typeof route.reasoning_effort !== "string",
    )
  ) {
    throw new Error("Judge Session is missing model-route evidence");
  }
  const first = routes[0];
  if (
    first === undefined ||
    routes.some(
      (route) =>
        route.provider !== first.provider ||
        route.model !== first.model ||
        route.reasoning_effort !== first.reasoning_effort,
    )
  ) {
    throw new Error("Judge Session model route changed across requests");
  }
  return first as JudgeCarrierResult["observedModelRoute"];
}

export class DshJudgeCarrier implements JudgeCarrier {
  readonly #launch: { readonly executable: string; readonly launcherArgs?: readonly string[] };
  readonly #workspace: string;
  readonly #commonPatch: string;
  readonly #judgePatch: string;
  readonly #runner: DshRunCarrier;

  constructor(input: {
    readonly launch: { readonly executable: string; readonly launcherArgs?: readonly string[] };
    readonly workspace: string;
    readonly commonPatch: string;
    readonly judgePatch: string;
    readonly runner?: DshRunCarrier;
  }) {
    this.#launch = input.launch;
    this.#workspace = input.workspace;
    this.#commonPatch = input.commonPatch;
    this.#judgePatch = input.judgePatch;
    this.#runner = input.runner ?? new DshRunCarrier();
  }

  async run(input: {
    readonly prompt: string;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
  }): Promise<JudgeCarrierResult> {
    if (input.maxOutputBytes > 256 * 1024) {
      throw new Error("Judge output cap exceeds the frozen carrier limit");
    }
    if ((await readdir(this.#workspace)).length !== 0) {
      throw new Error("Judge workspace must be an empty isolated directory");
    }
    const before = await scanRawSessionInventory(PHASE3C_JUDGE.sessionsRoot);
    const startedAt = new Date().toISOString();
    const terminal = await this.#runner.runEpisode({
      ...this.#launch,
      workspace: this.#workspace,
      commonPatch: this.#commonPatch,
      armPatch: this.#judgePatch,
      task: input.prompt,
      timeoutMs: input.timeoutMs,
      permissionMode: "read-only",
    });
    const endedAt = new Date().toISOString();
    const after = await scanRawSessionInventory(PHASE3C_JUDGE.sessionsRoot);
    const discovered = discoverFreshSession({
      before,
      after,
      workspace: this.#workspace,
      startedAt,
      endedAt,
    });
    const transcript = await readStableSessionTranscript(
      inventoryEntry(after, discovered.id).transcriptPath,
    );
    const observedModelRoute = verifyJudgeSession({
      transcript,
      workspace: this.#workspace,
    });
    if ((await readdir(this.#workspace)).length !== 0) {
      throw new Error("Judge process mutated its isolated workspace");
    }
    return {
      sessionId: discovered.id,
      sessionTranscriptSha256: sha256Hex(transcript),
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      stdout: terminal.stdout,
      stderr: terminal.stderr,
      timedOut: terminal.timedOut,
      outputLimitExceeded: terminal.outputLimitExceeded,
      observedModelRoute,
    };
  }
}
