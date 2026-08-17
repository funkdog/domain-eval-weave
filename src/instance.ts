import {
  assertDedicatedDshHomePreBoot,
  DEDICATED_DSH_HOME,
  DEDICATED_RUNTIME_ROOT,
} from "./runtime-root.js";

export const PHASE2_INSTANCE = {
  id: "clowder-ai",
  managementProfile: "eval-clowder",
  runnerProfile: "eval-clowder-runner",
  instanceRoot: `${DEDICATED_RUNTIME_ROOT}/instances/clowder-ai`,
  sessionsRoot: `${DEDICATED_DSH_HOME}/sessions/clowder-ai`,
} as const;

export type Phase2Instance = typeof PHASE2_INSTANCE;

export class Phase2InstanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Phase2InstanceError";
    this.code = code;
  }
}

export function resolvePhase2Instance(
  env: Readonly<Record<string, string | undefined>>,
): Phase2Instance {
  try {
    assertDedicatedDshHomePreBoot(env);
  } catch {
    throw new Phase2InstanceError(
      "PHASE2_DSH_HOME_INVALID",
      "Phase 2 requires the exact dedicated DSH_HOME before boot",
    );
  }
  if (env.DSH_EVAL_INSTANCE_ID !== PHASE2_INSTANCE.id) {
    throw new Phase2InstanceError(
      "PHASE2_INSTANCE_INVALID",
      `DSH_EVAL_INSTANCE_ID must equal ${PHASE2_INSTANCE.id}`,
    );
  }
  return PHASE2_INSTANCE;
}
