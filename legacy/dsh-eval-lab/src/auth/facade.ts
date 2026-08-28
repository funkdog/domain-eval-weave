import { z } from "zod";

const authStatusSchema = z.strictObject({
  schemaVersion: z.literal(1),
  package: z.literal("dsh-codex-connect"),
  version: z.literal("0.1.0-alpha.4.7"),
  status: z.enum(["signed-in", "signed-out"]),
});

export type AuthStatus = z.infer<typeof authStatusSchema>;

export interface AuthExecutionInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly stdio: "capture" | "inherit";
}

export interface AuthExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export class AuthContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthContractError";
    this.code = code;
  }
}

export class AuthFacade {
  readonly #executable: string;
  readonly #execute: (input: AuthExecutionInput) => Promise<AuthExecutionResult>;
  readonly #env: Readonly<Record<string, string>>;

  constructor(input: {
    readonly executable: string;
    readonly execute: (input: AuthExecutionInput) => Promise<AuthExecutionResult>;
    readonly env?: Readonly<Record<string, string>>;
  }) {
    this.#executable = input.executable;
    this.#execute = input.execute;
    this.#env = input.env ?? {};
  }

  async status(): Promise<AuthStatus> {
    const result = await this.#execute({
      executable: this.#executable,
      args: ["status", "--json"],
      env: this.#env,
      stdio: "capture",
    });
    if (result.stderr.trim().length > 0) {
      throw new AuthContractError(
        "AUTH_STATUS_INVALID",
        "auth status produced an unexpected diagnostic channel",
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(result.stdout);
    } catch {
      throw new AuthContractError("AUTH_STATUS_INVALID", "auth status was not valid JSON");
    }
    const parsed = authStatusSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new AuthContractError(
        "AUTH_STATUS_INVALID",
        "auth status did not satisfy the secret-free contract",
      );
    }
    if (result.exitCode !== 0 && parsed.data.status !== "signed-out") {
      throw new AuthContractError("AUTH_STATUS_FAILED", "auth status command failed");
    }
    return parsed.data;
  }

  async login(): Promise<{ readonly signedIn: boolean }> {
    const result = await this.#execute({
      executable: this.#executable,
      args: ["login", "--device-code"],
      env: this.#env,
      stdio: "inherit",
    });
    return { signedIn: result.exitCode === 0 };
  }
}
