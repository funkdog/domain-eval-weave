import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import type { CapsuleManifest } from "../capsule/contracts.js";
import { CapsuleError, type LoadedCapsule } from "../capsule/loader.js";

export interface CandidateExecution {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
}

export interface CandidateRunner {
  run(input: {
    readonly capsule: LoadedCapsule;
    readonly candidate: CapsuleManifest["candidates"][number];
  }): Promise<CandidateExecution>;
}

function literal(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function sandboxProfile(
  capsuleRoot: string,
  candidateRoot: string,
  scratchRoot: string,
  executable: string,
): string {
  const readable = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/dev",
    "/Library",
    "/private/etc",
    "/private/var",
    dirname(executable),
    dirname(dirname(executable)),
    candidateRoot,
    scratchRoot,
  ];
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow system-socket)",
    "(allow file-read-metadata)",
    "(allow file-read*)",
    ...readable.map((root) => `(allow file-read* (subpath ${literal(resolve(root))}))`),
    ...[
      "capsule.yaml",
      "domain.yaml",
      "sources",
      "requirements",
      "evaluators",
      "cases",
      ".eval/releases",
      ".eval/runs",
    ].map((path) => `(deny file-read* (subpath ${literal(resolve(capsuleRoot, path))}))`),
    ...[".codex", ".dsh", ".ssh", ".config/gh", "Library/Keychains"].map(
      (path) => `(deny file-read* (subpath ${literal(resolve(homedir(), path))}))`,
    ),
    `(allow file-write* (subpath ${literal(scratchRoot)}))`,
    '(allow file-write* (subpath "/dev"))',
    "(deny network*)",
  ].join("\n");
}

function resolveCommand(candidateRoot: string, command: readonly string[]) {
  const [rawExecutable, ...args] = command;
  if (rawExecutable === undefined) {
    throw new CapsuleError("CAPSULE_COMMAND_INVALID", "Candidate command is empty");
  }
  if (rawExecutable === "node") return { executable: process.execPath, args };
  if (
    rawExecutable.startsWith("/") ||
    rawExecutable.includes("\\") ||
    rawExecutable.includes("..")
  ) {
    throw new CapsuleError(
      "CAPSULE_COMMAND_DENIED",
      "Candidate executable must be node or a contained relative path",
      rawExecutable,
    );
  }
  return { executable: resolve(candidateRoot, rawExecutable), args };
}

export class SandboxedCommandRunner implements CandidateRunner {
  constructor(readonly sandboxExecutable = "/usr/bin/sandbox-exec") {}

  async run(input: {
    readonly capsule: LoadedCapsule;
    readonly candidate: CapsuleManifest["candidates"][number];
  }): Promise<CandidateExecution> {
    if (process.platform !== "darwin") {
      throw new CapsuleError(
        "CAPSULE_SANDBOX_UNAVAILABLE",
        "The default command adapter currently requires the macOS sandbox adapter",
      );
    }
    const candidateRoot = resolve(input.capsule.root, input.candidate.path);
    const scratchRoot = resolve(
      input.capsule.root,
      ".eval/tmp",
      `${input.candidate.candidate_id}-${process.pid}`,
    );
    await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    const command = resolveCommand(candidateRoot, input.candidate.command);
    const child = spawn(
      this.sandboxExecutable,
      [
        "-p",
        sandboxProfile(input.capsule.root, candidateRoot, scratchRoot, command.executable),
        command.executable,
        ...command.args,
      ],
      {
        cwd: candidateRoot,
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          LANG: "C",
          LC_ALL: "C",
          TMPDIR: scratchRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (child.stdout === null || child.stderr === null) {
      child.kill("SIGKILL");
      throw new CapsuleError("CAPSULE_PROCESS_INVALID", "Candidate output pipes are unavailable");
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      if (outputLimitExceeded) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > input.candidate.max_output_bytes) {
        outputLimitExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, input.candidate.timeout_ms);
    timeout.unref();
    return new Promise<CandidateExecution>((resolveExecution, reject) => {
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(new CapsuleError("CAPSULE_PROCESS_SPAWN_FAILED", error.message));
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timeout);
        resolveExecution({
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
