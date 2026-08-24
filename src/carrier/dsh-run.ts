import { spawn } from "node:child_process";

import { PHASE2_INSTANCE } from "../instance.js";
import { DEDICATED_DSH_HOME } from "../runtime-root.js";

export interface DshRunInput {
  readonly executable: string;
  readonly launcherArgs?: readonly string[];
  readonly workspace: string;
  readonly commonPatch: string;
  readonly armPatch: string;
  readonly task: string;
  readonly timeoutMs: number;
  readonly postOutputExitGraceMs?: number;
  readonly permissionMode?: "read-only" | "workspace-write";
}

export interface DshRunOutput {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;
const POST_OUTPUT_EXIT_GRACE_MS = 5_000;

export class DshRunCarrier {
  async runEpisode(input: DshRunInput): Promise<DshRunOutput> {
    const postOutputExitGraceMs = input.postOutputExitGraceMs ?? POST_OUTPUT_EXIT_GRACE_MS;
    if (!Number.isFinite(postOutputExitGraceMs) || postOutputExitGraceMs <= 0) {
      throw new RangeError("post-output exit grace must be positive and finite");
    }
    const child = spawn(
      input.executable,
      [
        ...(input.launcherArgs ?? []),
        "--profile",
        PHASE2_INSTANCE.runnerProfile,
        "--patch",
        input.commonPatch,
        "--patch",
        input.armPatch,
        input.task,
      ],
      {
        cwd: input.workspace,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          DSH_HOME: DEDICATED_DSH_HOME,
          DSH_EVAL_INSTANCE_ID: PHASE2_INSTANCE.id,
          DSH_TOOLS_MODE: "native",
          DSH_PERMISSION_MODE: input.permissionMode ?? "workspace-write",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let outputLimitExceeded = false;
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
    // Pinned DSH headless writes stdout only after the Session is flushed, then requests appExit.
    // rc.6 can retain an active handle after that request, so close the already-complete process
    // through its bounded SIGTERM shutdown path if it does not exit naturally.
    child.stdout.on("data", capture(stdout, armPostOutputExit));
    child.stderr.on("data", capture(stderr));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    timeout.unref();
    return new Promise((resolveOutput, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        clearTimeout(timeout);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (postOutputExitTimer !== undefined) clearTimeout(postOutputExitTimer);
        resolveOutput({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
          outputLimitExceeded,
        });
      });
    });
  }
}
