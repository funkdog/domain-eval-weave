import { assertDedicatedDshHomePreBoot } from "../runtime-root.js";
import { type AppInvocation, AppUsageError, EXIT_CODE, parseAppArguments } from "./args.js";
import { createDefaultAppExecutor } from "./default-executor.js";
import type { DshEvalCommandExecutor } from "./startup.js";

export const name = "dsh-eval-app";
export const inject = ["cmdlineArgs", "appExit"] as const;

export interface DshEvalAppContext {
  readonly cmdlineArgs: { get(): readonly string[] };
  readonly appExit: (code: number) => void;
  provide(name: "dshEvalApp", invocation: AppInvocation): void;
}

export interface DshEvalAppConfig {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly executor?: DshEvalCommandExecutor;
}

export default function applyDshEvalApp(
  context: DshEvalAppContext,
  config: DshEvalAppConfig = {},
): Promise<void> {
  assertDedicatedDshHomePreBoot(config.env ?? process.env);
  let invocation: AppInvocation;
  try {
    invocation = parseAppArguments(context.cmdlineArgs.get());
  } catch (error) {
    if (!(error instanceof AppUsageError)) throw error;
    context.appExit(EXIT_CODE.USAGE_OR_CONTRACT);
    return Promise.resolve();
  }
  context.provide("dshEvalApp", invocation);
  return (config.executor ?? createDefaultAppExecutor())
    .execute(invocation)
    .then((exitCode) => context.appExit(exitCode));
}

export type { AppInvocation, ExitCode } from "./args.js";
export { AppUsageError, EXIT_CODE, parseAppArguments } from "./args.js";
export type { DshEvalCommandExecutor } from "./startup.js";
