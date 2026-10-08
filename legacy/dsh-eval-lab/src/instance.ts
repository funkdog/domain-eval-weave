import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

export const PHASE3A_AUTHOR = {
  profile: "eval-clowder-author",
  sessionsRoot: `${DEDICATED_DSH_HOME}/sessions/clowder-ai-author`,
} as const;

export const PHASE3C_JUDGE = {
  profile: PHASE2_INSTANCE.runnerProfile,
  sessionsRoot: `${DEDICATED_DSH_HOME}/sessions/clowder-ai-judge`,
} as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

export function assertCurrentPhase2Profile(
  rootBaseUrl: string | undefined,
  role: "management" | "runner",
): void {
  const profile =
    role === "management" ? PHASE2_INSTANCE.managementProfile : PHASE2_INSTANCE.runnerProfile;
  const expected = pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/${profile}/`).href;
  if (rootBaseUrl !== expected) {
    throw new Phase2InstanceError(
      "PHASE2_PROFILE_INVALID",
      `current DSH profile must be ${profile}`,
    );
  }
}

export function assertCurrentPhase3AuthorProfile(rootBaseUrl: string | undefined): void {
  const expected = pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/${PHASE3A_AUTHOR.profile}/`).href;
  if (rootBaseUrl !== expected) {
    throw new Phase2InstanceError(
      "PHASE3A_AUTHOR_PROFILE_INVALID",
      `current DSH profile must be ${PHASE3A_AUTHOR.profile}`,
    );
  }
}

export function phase2CalibrationPath(taskPackDigest: string, evalPackageDigest: string): string {
  if (!SHA256_PATTERN.test(taskPackDigest) || !SHA256_PATTERN.test(evalPackageDigest)) {
    throw new Phase2InstanceError(
      "PHASE2_CALIBRATION_KEY_INVALID",
      "Phase 2 calibration keys must be lowercase SHA-256 digests",
    );
  }
  return `${PHASE2_INSTANCE.instanceRoot}/calibration/${taskPackDigest}--${evalPackageDigest}.json`;
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
  "domain-confirmations",
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

export async function ensurePhase3AuthorLayout(): Promise<void> {
  await validateContainedDirectory(DEDICATED_DSH_HOME, PHASE3A_AUTHOR.sessionsRoot, true);
}

export async function assertPhase3AuthorLayout(): Promise<void> {
  await validateContainedDirectory(DEDICATED_DSH_HOME, PHASE3A_AUTHOR.sessionsRoot, false);
}

export async function ensurePhase3cJudgeLayout(): Promise<void> {
  await validateContainedDirectory(DEDICATED_DSH_HOME, PHASE3C_JUDGE.sessionsRoot, true);
}

export async function assertPhase3cJudgeLayout(): Promise<void> {
  await validateContainedDirectory(DEDICATED_DSH_HOME, PHASE3C_JUDGE.sessionsRoot, false);
}
