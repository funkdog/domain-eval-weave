import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";

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
      ".eval/calibrations",
    ].map((path) => `(deny file-read* (subpath ${literal(resolve(capsuleRoot, path))}))`),
    ...[".codex", ".dsh", ".ssh", ".config/gh", "Library/Keychains"].map(
      (path) => `(deny file-read* (subpath ${literal(resolve(homedir(), path))}))`,
    ),
    `(allow file-write* (subpath ${literal(scratchRoot)}))`,
    '(allow file-write* (subpath "/dev"))',
    "(deny network*)",
  ].join("\n");
}

export interface CandidateSandboxPlan {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export function buildCandidateSandboxPlan(input: {
  readonly platform: NodeJS.Platform;
  readonly capsuleRoot: string;
  readonly candidateRoot: string;
  readonly scratchRoot: string;
  readonly command: { readonly executable: string; readonly args: readonly string[] };
  readonly sandboxExecutable?: string;
}): CandidateSandboxPlan {
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" };
  if (input.platform === "darwin") {
    return {
      executable: input.sandboxExecutable ?? "/usr/bin/sandbox-exec",
      args: [
        "-p",
        sandboxProfile(
          input.capsuleRoot,
          input.candidateRoot,
          input.scratchRoot,
          input.command.executable,
        ),
        input.command.executable,
        ...input.command.args,
      ],
      cwd: input.candidateRoot,
      env: { ...env, TMPDIR: input.scratchRoot },
    };
  }
  if (input.platform === "linux") {
    const systemRoots = ["/usr", "/bin", "/lib", "/lib64", "/etc/alternatives", "/etc/ld.so.cache"]
      .filter(existsSync)
      .flatMap((root) => ["--ro-bind", root, root]);
    const executableRelation = relative(input.candidateRoot, input.command.executable);
    const executable =
      executableRelation !== "" &&
      !executableRelation.startsWith("..") &&
      !executableRelation.startsWith("/")
        ? `/candidate/${executableRelation.split("\\").join("/")}`
        : input.command.executable;
    return {
      executable: input.sandboxExecutable ?? "/usr/bin/bwrap",
      args: [
        "--die-with-parent",
        "--unshare-all",
        "--new-session",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        ...systemRoots,
        "--ro-bind",
        input.candidateRoot,
        "/candidate",
        "--bind",
        input.scratchRoot,
        "/scratch",
        "--chdir",
        "/candidate",
        "--clearenv",
        "--setenv",
        "PATH",
        env.PATH,
        "--setenv",
        "LANG",
        env.LANG,
        "--setenv",
        "LC_ALL",
        env.LC_ALL,
        "--setenv",
        "TMPDIR",
        "/scratch",
        "--",
        executable,
        ...input.command.args,
      ],
      cwd: input.candidateRoot,
      env,
    };
  }
  throw new CapsuleError(
    "CAPSULE_SANDBOX_UNAVAILABLE",
    `Unsupported Candidate sandbox platform: ${input.platform}`,
  );
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
  readonly #platform: NodeJS.Platform;
  readonly #sandboxExecutable: string | undefined;

  constructor(
    options:
      | string
      | { readonly platform?: NodeJS.Platform; readonly sandboxExecutable?: string } = {},
  ) {
    if (typeof options === "string") {
      this.#platform = process.platform;
      this.#sandboxExecutable = options;
    } else {
      this.#platform = options.platform ?? process.platform;
      this.#sandboxExecutable = options.sandboxExecutable;
    }
  }

  async run(input: {
    readonly capsule: LoadedCapsule;
    readonly candidate: CapsuleManifest["candidates"][number];
  }): Promise<CandidateExecution> {
    const candidateRoot = resolve(input.capsule.root, input.candidate.path);
    const scratchRoot = resolve(
      input.capsule.root,
      ".eval/tmp",
      `${input.candidate.candidate_id}-${process.pid}`,
    );
    const command = resolveCommand(candidateRoot, input.candidate.command);
    const plan = buildCandidateSandboxPlan({
      platform: this.#platform,
      capsuleRoot: input.capsule.root,
      candidateRoot,
      scratchRoot,
      command,
      ...(this.#sandboxExecutable === undefined
        ? {}
        : { sandboxExecutable: this.#sandboxExecutable }),
    });
    try {
      await access(plan.executable, constants.X_OK);
    } catch {
      throw new CapsuleError(
        "CAPSULE_SANDBOX_UNAVAILABLE",
        `Candidate sandbox executable is unavailable: ${plan.executable}`,
      );
    }
    await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    const child = spawn(plan.executable, [...plan.args], {
      cwd: plan.cwd,
      env: plan.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
