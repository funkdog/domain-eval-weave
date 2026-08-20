import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  FORWARD_RUN_NONCE_ENV,
  FORWARD_RUN_ROOT_ENV,
  ForwardEvidenceStore,
  type ForwardRunReceipt,
} from "../author-evidence/index.js";
import { sha256Hex } from "../contracts/canonical-json.js";
import { PHASE2_INSTANCE, PHASE3A_AUTHOR } from "../instance.js";
import { verifySharedModelSettings } from "../runtime-profile/init.js";
import { DEDICATED_DSH_HOME } from "../runtime-root.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const POST_OUTPUT_EXIT_GRACE_MS = 5_000;
const ERROR_MARKERS = ["PI_AI_ERROR", "PI_AUTH_ERROR", "PI_MODEL_ERROR", "PI_SDK_ERROR"] as const;
const FORWARD_MODEL_ROUTE = {
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  effort: "xhigh",
} as const;

export interface AuthorForwardInput {
  readonly executable: string;
  readonly launcherArgs?: readonly string[];
  readonly workspace: string;
  readonly task: string;
  readonly timeoutMs: number;
  readonly postOutputExitGraceMs?: number;
  readonly evidenceRoot: string;
  readonly runId: string;
  readonly sourceRevision: string;
  readonly packageTarPath: string;
  readonly fixtureSetSha256: string;
}

export interface AuthorForwardOutput {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly receipt: ForwardRunReceipt;
}

export interface AuthorForwardCarrierDependencies {
  readonly verifyModelSettings?: () => Promise<void>;
}

export class AuthorForwardCarrier {
  readonly #verifyModelSettings: () => Promise<void>;

  constructor(dependencies: AuthorForwardCarrierDependencies = {}) {
    this.#verifyModelSettings =
      dependencies.verifyModelSettings ?? (() => verifySharedModelSettings(DEDICATED_DSH_HOME));
  }

  async run(input: AuthorForwardInput): Promise<AuthorForwardOutput> {
    const postOutputExitGraceMs = input.postOutputExitGraceMs ?? POST_OUTPUT_EXIT_GRACE_MS;
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new RangeError("author forward timeout must be positive and finite");
    }
    if (!Number.isFinite(postOutputExitGraceMs) || postOutputExitGraceMs <= 0) {
      throw new RangeError("post-output exit grace must be positive and finite");
    }
    await this.#verifyModelSettings();
    const packageTar = await readFile(input.packageTarPath);
    const store = new ForwardEvidenceStore(input.evidenceRoot);
    const handle = await store.beginRun({
      runId: input.runId,
      sourceRevision: input.sourceRevision,
      packageTar: { sha256: sha256Hex(packageTar), size: packageTar.byteLength },
      profile: PHASE3A_AUTHOR.profile,
      provider: FORWARD_MODEL_ROUTE.provider,
      model: FORWARD_MODEL_ROUTE.model,
      effort: FORWARD_MODEL_ROUTE.effort,
      promptSha256: sha256Hex(input.task),
      fixtureSetSha256: input.fixtureSetSha256,
      startedAt: new Date().toISOString(),
    });
    const child = spawn(
      input.executable,
      [...(input.launcherArgs ?? []), "--profile", PHASE3A_AUTHOR.profile, input.task],
      {
        cwd: input.workspace,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          DSH_HOME: DEDICATED_DSH_HOME,
          DSH_EVAL_INSTANCE_ID: PHASE2_INSTANCE.id,
          DSH_TOOLS_MODE: "native",
          DSH_PERMISSION_MODE: "workspace-write",
          [FORWARD_RUN_ROOT_ENV]: handle.runRoot,
          [FORWARD_RUN_NONCE_ENV]: handle.nonce,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let spawnError = false;
    let killTimer: NodeJS.Timeout | undefined;
    let postOutputExitTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref();
    };
    const armPostOutputExit = () => {
      if (postOutputExitTimer !== undefined) clearTimeout(postOutputExitTimer);
      postOutputExitTimer = setTimeout(terminate, postOutputExitGraceMs);
      postOutputExitTimer.unref();
    };
    const capture = (target: Buffer[], onData?: () => void) => (chunk: Buffer) => {
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - outputBytes);
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining);
        target.push(Buffer.from(retained));
        outputBytes += retained.byteLength;
      }
      if (chunk.byteLength > remaining && !outputLimitExceeded) {
        outputLimitExceeded = true;
        terminate();
      }
      if (!outputLimitExceeded) onData?.();
    };
    child.stdout.on("data", capture(stdout, armPostOutputExit));
    child.stderr.on("data", capture(stderr));
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    timeout.unref();
    const terminal = await new Promise<{ exitCode: number | null; signal: string | null }>(
      (resolveTerminal) => {
        child.once("error", () => {
          spawnError = true;
        });
        child.once("close", (exitCode, signal) => {
          resolveTerminal({ exitCode, signal });
        });
      },
    );
    clearTimeout(timeout);
    if (killTimer !== undefined) clearTimeout(killTimer);
    if (postOutputExitTimer !== undefined) clearTimeout(postOutputExitTimer);
    const stdoutText = Buffer.concat(stdout).toString("utf8");
    const stderrText = Buffer.concat(stderr).toString("utf8");
    const combined = `${stdoutText}\n${stderrText}`;
    const errorMarkers: string[] = ERROR_MARKERS.filter((marker) => combined.includes(marker));
    if (spawnError) errorMarkers.push("SPAWN_ERROR");
    const receipt = await store.completeRun(handle, {
      endedAt: new Date().toISOString(),
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      timedOut,
      outputLimitExceeded,
      finalOutputSeen: stdoutText.trim().length > 0,
      errorMarkers,
      stdoutSha256: sha256Hex(stdoutText),
      stderrSha256: sha256Hex(stderrText),
    });
    return {
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      stdout: stdoutText,
      stderr: stderrText,
      timedOut,
      outputLimitExceeded,
      receipt,
    };
  }
}
