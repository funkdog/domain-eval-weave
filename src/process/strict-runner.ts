import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface StrictProcessInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly readableRoots: readonly string[];
  readonly writableRoot: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
}

export interface StrictProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
}

export class StrictProcessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StrictProcessError";
    this.code = code;
  }
}

function sandboxLiteral(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function sandboxProfile(input: StrictProcessInput): string {
  const denied = ["/Users/slipshod", "/Volumes", "/Network"];
  const readable = new Set([
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/dev",
    "/Library",
    "/private/etc",
    "/private/var",
    dirname(resolve(input.executable)),
    dirname(dirname(resolve(input.executable))),
    resolve(input.cwd),
    ...input.readableRoots.map((root) => resolve(root)),
    resolve(input.writableRoot),
  ]);
  const lines = [
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
    ...denied.map((root) => `(deny file-read* (subpath ${sandboxLiteral(root)}))`),
    ...[...readable].map((root) => `(allow file-read* (subpath ${sandboxLiteral(root)}))`),
    `(allow file-write* (subpath ${sandboxLiteral(resolve(input.writableRoot))}))`,
    '(allow file-write* (subpath "/dev"))',
    "(deny network*)",
  ];
  return lines.join("\n");
}

function sanitizedEnvironment(
  writableRoot: string,
  additions: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const allowedNames = new Set(["ORACLE_CHECK", "ORACLE_SEED"]);
  for (const name of Object.keys(additions)) {
    if (!allowedNames.has(name)) {
      throw new StrictProcessError(
        "PROCESS_ENV_DENIED",
        `environment variable is not allowlisted: ${name}`,
      );
    }
  }
  return {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C",
    LC_ALL: "C",
    TMPDIR: resolve(writableRoot),
    ...additions,
  };
}

export class StrictProcessRunner {
  readonly #sandboxExecutable: string;

  constructor(sandboxExecutable = "/usr/bin/sandbox-exec") {
    this.#sandboxExecutable = sandboxExecutable;
  }

  async run(input: StrictProcessInput): Promise<StrictProcessResult> {
    if (
      input.timeoutMs <= 0 ||
      !Number.isFinite(input.timeoutMs) ||
      input.maxOutputBytes <= 0 ||
      !Number.isSafeInteger(input.maxOutputBytes) ||
      (input.stdin !== undefined && Buffer.byteLength(input.stdin) > 256 * 1024)
    ) {
      throw new StrictProcessError("PROCESS_LIMIT_INVALID", "process limits must be positive");
    }
    await mkdir(input.writableRoot, { recursive: true, mode: 0o700 });
    const child = spawn(
      this.#sandboxExecutable,
      ["-p", sandboxProfile(input), input.executable, ...input.args],
      {
        cwd: input.cwd,
        env: sanitizedEnvironment(input.writableRoot, input.env),
        stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      },
    );

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    if (child.stdout === null || child.stderr === null) {
      throw new StrictProcessError("PROCESS_SPAWN_FAILED", "process output pipes are unavailable");
    }
    let outputBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      if (outputLimitExceeded) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > input.maxOutputBytes) {
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
    }, input.timeoutMs);
    timeout.unref();

    const resultPromise = new Promise<StrictProcessResult>((resolveResult, reject) => {
      child.once("error", (error) =>
        reject(new StrictProcessError("PROCESS_SPAWN_FAILED", error.message)),
      );
      child.once("close", (exitCode, signal) => {
        clearTimeout(timeout);
        resolveResult({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
          outputLimitExceeded,
        });
      });
    });
    if (input.stdin !== undefined && child.stdin !== null) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(input.stdin);
    }
    return resultPromise;
  }
}
