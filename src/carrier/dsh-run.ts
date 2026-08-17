import { spawn } from "node:child_process";

import { DEDICATED_DSH_HOME } from "../runtime-root.js";

export interface DshRunInput {
  readonly executable: string;
  readonly launcherArgs?: readonly string[];
  readonly workspace: string;
  readonly commonPatch: string;
  readonly armPatch: string;
  readonly task: string;
  readonly timeoutMs: number;
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

export class DshRunCarrier {
  async runEpisode(input: DshRunInput): Promise<DshRunOutput> {
    const child = spawn(
      input.executable,
      [
        ...(input.launcherArgs ?? []),
        "--profile",
        "eval-runner",
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
          DSH_TOOLS_MODE: "native",
          DSH_PERMISSION_MODE: "workspace-write",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let outputLimitExceeded = false;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref();
    };
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
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
    };
    child.stdout.on("data", capture(stdout));
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
