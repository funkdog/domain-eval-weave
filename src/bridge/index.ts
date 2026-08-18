import {
  assertCurrentPhase2Profile,
  assertPhase2InstanceLayout,
  resolvePhase2Instance,
} from "../instance.js";
import { StrictProcessRunner } from "../process/strict-runner.js";
import { createWorkspaceToolGuard, type GuardedToolExecution } from "./guard.js";
import { createWorkspaceTestDefinition, type WorkspaceTestRunner } from "./workspace-test.js";

export const name = "dsh-eval-bridge";
export const inject = ["tools"] as const;

export interface DshEvalBridgeContext {
  readonly root: { readonly baseUrl?: string };
  readonly tools: {
    guard(guard: (execution: GuardedToolExecution) => string | undefined): unknown;
    register(definition: ReturnType<typeof createWorkspaceTestDefinition>): unknown;
  };
}

export interface DshEvalBridgeConfig {
  readonly workspaceRoot?: string;
  readonly runner?: WorkspaceTestRunner;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function strictWorkspaceTestRunner(workspaceRoot: string): WorkspaceTestRunner {
  const runner = new StrictProcessRunner();
  return {
    run: (input) =>
      runner.run({
        executable: process.execPath,
        args: input.argv.slice(1),
        cwd: input.cwd,
        readableRoots: [workspaceRoot],
        writableRoot: `${workspaceRoot}/tmp`,
        timeoutMs: 120_000,
        maxOutputBytes: 256 * 1024,
      }),
  };
}

async function applyDshEvalBridge(
  context: DshEvalBridgeContext,
  config: DshEvalBridgeConfig = {},
): Promise<void> {
  resolvePhase2Instance(config.env ?? process.env);
  assertCurrentPhase2Profile(context.root.baseUrl, "runner");
  await assertPhase2InstanceLayout();
  const workspaceRoot = config.workspaceRoot ?? process.cwd();
  context.tools.guard(createWorkspaceToolGuard({ workspaceRoot }));
  context.tools.register(
    createWorkspaceTestDefinition({
      workspaceRoot,
      runner: config.runner ?? strictWorkspaceTestRunner(workspaceRoot),
    }),
  );
}

export default Object.assign(applyDshEvalBridge, { inject });

export { createWorkspaceToolGuard } from "./guard.js";
export { createWorkspaceTestDefinition } from "./workspace-test.js";
