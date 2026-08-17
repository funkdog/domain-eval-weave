import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

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

async function validateContainedDirectory(
  root: string,
  target: string,
  createMissing: boolean,
): Promise<void> {
  const absoluteRoot = resolve(root);
  const relation = relative(absoluteRoot, resolve(target));
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Phase2InstanceError(
      "PHASE2_PATH_INVALID",
      "Phase 2 directory must be a strict child of its frozen root",
    );
  }
  let current = absoluteRoot;
  for (const segment of relation.split("/")) {
    current = resolve(current, segment);
    if (createMissing) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw new Phase2InstanceError(
        "PHASE2_PATH_INVALID",
        `Phase 2 directory is missing: ${current}`,
      );
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      (await realpath(current)) !== current
    ) {
      throw new Phase2InstanceError(
        "PHASE2_PATH_INVALID",
        `Phase 2 directory must be a physical 0700 directory: ${current}`,
      );
    }
  }
}

export async function assertContainedPhase2Directory(root: string, target: string): Promise<void> {
  await validateContainedDirectory(root, target, false);
}

const INSTANCE_SUBDIRECTORIES = [
  "calibration",
  "campaigns",
  "exposures",
  "oracle-tmp",
  "qualification",
  "suites",
  "workspaces",
] as const;

async function validatePhase2InstanceLayout(createMissing: boolean): Promise<void> {
  await Promise.all([
    validateContainedDirectory(DEDICATED_RUNTIME_ROOT, PHASE2_INSTANCE.instanceRoot, createMissing),
    validateContainedDirectory(DEDICATED_DSH_HOME, PHASE2_INSTANCE.sessionsRoot, createMissing),
  ]);
  for (const name of INSTANCE_SUBDIRECTORIES) {
    await validateContainedDirectory(
      PHASE2_INSTANCE.instanceRoot,
      `${PHASE2_INSTANCE.instanceRoot}/${name}`,
      createMissing,
    );
  }
}

export async function ensurePhase2InstanceLayout(): Promise<void> {
  await validatePhase2InstanceLayout(true);
}

export async function assertPhase2InstanceLayout(): Promise<void> {
  await validatePhase2InstanceLayout(false);
}
