import { assertDedicatedDshHomePreBoot } from "../runtime-root.js";
import { type AppInvocation, parseAppArguments } from "./args.js";

export const name = "dsh-eval-app";
export const inject = ["cmdlineArgs"] as const;

export interface DshEvalAppContext {
  readonly cmdlineArgs: { get(): readonly string[] };
  provide(name: "dshEvalApp", invocation: AppInvocation): void;
}

export default function applyDshEvalApp(
  context: DshEvalAppContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  assertDedicatedDshHomePreBoot(env);
  const invocation = parseAppArguments(context.cmdlineArgs.get());
  context.provide("dshEvalApp", invocation);
}

export type { AppInvocation, ExitCode } from "./args.js";
export { AppUsageError, EXIT_CODE, parseAppArguments } from "./args.js";
