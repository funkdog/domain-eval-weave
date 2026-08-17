import type { AppInvocation, ExitCode } from "./args.js";

export interface DshEvalCommandExecutor {
  execute(invocation: AppInvocation): Promise<ExitCode>;
}

export class AppExecutionError extends Error {
  readonly exitCode: ExitCode;

  constructor(exitCode: ExitCode, message: string) {
    super(message);
    this.name = "AppExecutionError";
    this.exitCode = exitCode;
  }
}
