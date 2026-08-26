import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "@dsh-eval/lab/internal/canonical-json";
import { z } from "zod";

const HARNESS_BUCKETS = ["TDD-suitable", "borderline", "non-trigger", "holdout"] as const;

export const TDD_SKILL_BINDING = {
  schema_version: 1,
  skill_id: "mattpocock-tdd",
  repository: "mattpocock/skills",
  commit: "5b15a47f2d7150f545fbcacbfe381787fc0230dc",
  source_path: "skills/engineering/tdd",
  files: [
    {
      path: "SKILL.md",
      git_blob_sha1: "8fc086710806190ee7c4baa32089cb877a75736a",
      sha256: "cb01f66bebfaa25fa1f88e6b7e769cd9fd9f35b1120b8563749820738814c927",
      size: 3_549,
    },
    {
      path: "tests.md",
      git_blob_sha1: "7ab86479f925a1f9e8ba680af33cb3b12e015381",
      sha256: "859f9e592c188fda4fc7277dd180e4ce9c7a2e13f6efe1f6f29eccc9d28c106a",
      size: 2_214,
    },
    {
      path: "mocking.md",
      git_blob_sha1: "71cbfee674d93244ce81d1830b930ca9a69200bd",
      sha256: "3ceb807fdf4a47d6a93d4d9a891e5ba6d362a6247bd08adc451feebfc17361ef",
      size: 1_481,
    },
    {
      path: "agents/openai.yaml",
      git_blob_sha1: "651b838a7663e027b1b8884491e867f26bb9a021",
      sha256: "ea6f01cf1b8c06a4b0f5b649d74b1b8ce8685e72af1b38d70d877693e092af0b",
      size: 87,
    },
  ],
  license: {
    spdx_id: "MIT",
    git_blob_sha1: "f1dd2c09108dde1a5f56097cee8461b3ea834499",
    sha256: "0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5",
    size: 1_068,
  },
} as const;

export const tddSkillBindingSchema = z.custom<typeof TDD_SKILL_BINDING>(
  (value) => canonicalJson(value) === canonicalJson(TDD_SKILL_BINDING),
  "TDD Skill binding must equal the frozen upstream closure",
);

const safeRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => {
    if (value.startsWith("/") || value.includes("\\")) return false;
    const segments = value.split("/");
    return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
  }, "path must be a safe relative path");

export const tddTaskEntrySchema = z
  .strictObject({
    schema_version: z.literal(1),
    task_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    bucket: z.enum(HARNESS_BUCKETS),
    preconfirmed_test_seams: z
      .array(z.string().min(1))
      .min(1)
      .refine((values) => new Set(values).size === values.length),
    allowed_test_roots: z
      .array(safeRelativePathSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length),
    allowed_production_roots: z
      .array(safeRelativePathSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length),
  })
  .superRefine((value, context) => {
    const overlaps = value.allowed_test_roots.some((testRoot) =>
      value.allowed_production_roots.some(
        (productionRoot) =>
          testRoot === productionRoot ||
          testRoot.startsWith(`${productionRoot}/`) ||
          productionRoot.startsWith(`${testRoot}/`),
      ),
    );
    if (overlaps)
      context.addIssue({
        code: "custom",
        path: ["allowed_test_roots"],
        message: "test and production roots must be disjoint",
      });
  });

export const tddTaskRegistrySchema = z
  .strictObject({
    schema_version: z.literal(1),
    registry_id: z.literal("phase3c-tdd-task-registry-v1"),
    skill_binding_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    tasks: z.array(tddTaskEntrySchema).min(4),
  })
  .superRefine((value, context) => {
    if (value.skill_binding_sha256 !== canonicalJsonDigest(TDD_SKILL_BINDING)) {
      context.addIssue({
        code: "custom",
        path: ["skill_binding_sha256"],
        message: "Task Registry does not bind the frozen TDD Skill",
      });
    }
    if (new Set(value.tasks.map((task) => task.task_id)).size !== value.tasks.length) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "Task ids must be unique",
      });
    }
    const buckets = new Set(value.tasks.map((task) => task.bucket));
    if (HARNESS_BUCKETS.some((bucket) => !buckets.has(bucket))) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "Task Registry must cover every frozen opportunity bucket",
      });
    }
  });

const deploymentDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const tddSkillDeploymentSchema = z.discriminatedUnion("availability", [
  z.strictObject({
    schema_version: z.literal(1),
    availability: z.literal("available"),
    skill_binding_sha256: deploymentDigestSchema,
    package_tree_sha256: deploymentDigestSchema,
    control_profile_rows_sha256: deploymentDigestSchema,
    treatment_profile_rows_sha256: deploymentDigestSchema,
    model_visible_skill_sha256: deploymentDigestSchema,
    only_declared_difference: z.literal(true),
  }),
  z.strictObject({
    schema_version: z.literal(1),
    availability: z.literal("unavailable"),
    skill_binding_sha256: deploymentDigestSchema,
    reason: z.enum(["skill_not_installed", "profile_not_published", "identity_unverifiable"]),
  }),
]);

const tddEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    seq: z.number().int().nonnegative(),
    type: z.literal("skill_loaded"),
    skill_id: z.literal("mattpocock-tdd"),
  }),
  z.strictObject({
    seq: z.number().int().nonnegative(),
    type: z.literal("file_write"),
    path: safeRelativePathSchema,
  }),
  z.strictObject({
    seq: z.number().int().nonnegative(),
    type: z.literal("test_run"),
    scope: z.enum(["focused", "full"]),
    exit_code: z.number().int(),
  }),
  z.strictObject({
    seq: z.number().int().nonnegative(),
    type: z.literal("dependency_request"),
    dependency_id: z.literal("codebase-design"),
  }),
]);

export type TddTaskEntry = z.infer<typeof tddTaskEntrySchema>;
export type TddTaskRegistry = z.infer<typeof tddTaskRegistrySchema>;
export type TddSkillDeployment = z.infer<typeof tddSkillDeploymentSchema>;
export type TddEvent = z.infer<typeof tddEventSchema>;

export const parseTddSkillBinding = (value: unknown) => tddSkillBindingSchema.parse(value);
export const parseTddTaskEntry = (value: unknown): TddTaskEntry => tddTaskEntrySchema.parse(value);
export const parseTddTaskRegistry = (value: unknown): TddTaskRegistry =>
  tddTaskRegistrySchema.parse(value);
export const parseTddSkillDeployment = (value: unknown): TddSkillDeployment =>
  tddSkillDeploymentSchema.parse(value);

export function unavailableTddSkillDeployment(
  reason: Extract<TddSkillDeployment, { availability: "unavailable" }>["reason"],
): TddSkillDeployment {
  return parseTddSkillDeployment({
    schema_version: 1,
    availability: "unavailable",
    skill_binding_sha256: canonicalJsonDigest(TDD_SKILL_BINDING),
    reason,
  });
}

export async function verifyInstalledTddSkill(skillRootInput: string): Promise<string> {
  const skillRoot = resolve(skillRootInput);
  const root = await lstat(skillRoot);
  if (root.isSymbolicLink() || !root.isDirectory() || (await realpath(skillRoot)) !== skillRoot) {
    throw new Error("TDD Skill deployment root must be one physical directory");
  }
  const expected = [
    ...TDD_SKILL_BINDING.files.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      size: entry.size,
    })),
    {
      path: "LICENSE",
      sha256: TDD_SKILL_BINDING.license.sha256,
      size: TDD_SKILL_BINDING.license.size,
    },
  ];
  const actualFiles: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = `${directory}/${name}`;
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new Error("TDD Skill deployment cannot contain symlinks");
      if (entry.isDirectory()) await walk(path, relativePath);
      else if (entry.isFile() && entry.nlink === 1) actualFiles.push(relativePath);
      else throw new Error("TDD Skill deployment contains a non-physical entry");
    }
  }
  await walk(skillRoot, "");
  if (canonicalJson(actualFiles) !== canonicalJson(expected.map((entry) => entry.path).sort())) {
    throw new Error("TDD Skill deployment closure has missing or extra files");
  }
  const closure = [];
  for (const expectedFile of expected) {
    const path = resolve(skillRoot, expectedFile.path);
    const entry = await lstat(path);
    const bytes = await readFile(path);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      entry.nlink !== 1 ||
      entry.size !== expectedFile.size ||
      sha256Hex(bytes) !== expectedFile.sha256
    ) {
      throw new Error(`TDD Skill deployment identity drifted: ${expectedFile.path}`);
    }
    closure.push({ path: expectedFile.path, sha256: expectedFile.sha256, size: expectedFile.size });
  }
  return canonicalJsonDigest(closure);
}

function inRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

export function projectTddMechanism(input: {
  readonly task: unknown;
  readonly arm: "control" | "treatment";
  readonly events: readonly unknown[];
}) {
  const task = parseTddTaskEntry(input.task);
  const events = input.events.map((event) => tddEventSchema.parse(event));
  for (let index = 1; index < events.length; index += 1) {
    const current = events[index];
    const previous = events[index - 1];
    if (current === undefined || previous === undefined)
      throw new Error("TDD event sequence is sparse");
    if (current.seq <= previous.seq) throw new Error("TDD events must have a strict sequence");
  }
  const loaded = events.some((event) => event.type === "skill_loaded");
  const dependencyEscape = events.some((event) => event.type === "dependency_request");
  const writes = events.filter(
    (event): event is Extract<TddEvent, { type: "file_write" }> => event.type === "file_write",
  );
  const unauthorized = writes.filter(
    (event) =>
      !inRoots(event.path, task.allowed_test_roots) &&
      !inRoots(event.path, task.allowed_production_roots),
  );
  const testWrites = writes.filter((event) => inRoots(event.path, task.allowed_test_roots));
  const productionWrites = writes.filter((event) =>
    inRoots(event.path, task.allowed_production_roots),
  );
  const firstTest = testWrites[0]?.seq;
  const firstProduction = productionWrites[0]?.seq;
  const firstTestBeforeProduction =
    firstTest !== undefined && firstProduction !== undefined && firstTest < firstProduction;
  const testRuns = events.filter(
    (event): event is Extract<TddEvent, { type: "test_run" }> => event.type === "test_run",
  );
  const red = testRuns.find(
    (event) =>
      event.scope === "focused" &&
      event.exit_code !== 0 &&
      firstTest !== undefined &&
      event.seq > firstTest &&
      (firstProduction === undefined || event.seq < firstProduction),
  );
  const green = testRuns.find(
    (event) =>
      event.scope === "focused" &&
      event.exit_code === 0 &&
      firstProduction !== undefined &&
      event.seq > firstProduction,
  );
  const lastProduction = productionWrites.at(-1)?.seq;
  const fullGreen = testRuns.find(
    (event) =>
      event.scope === "full" &&
      event.exit_code === 0 &&
      green !== undefined &&
      event.seq > green.seq &&
      (lastProduction === undefined || event.seq > lastProduction),
  );
  const refactorAfterGreen =
    green !== undefined && productionWrites.some((event) => event.seq > green.seq);
  const reasons = [
    ...(input.arm === "control" && loaded ? ["CONTROL_SKILL_LEAK"] : []),
    ...(dependencyEscape ? ["HARNESS_DEPENDENCY_ESCAPE"] : []),
    ...(unauthorized.length > 0 ? ["UNAUTHORIZED_TDD_PATH"] : []),
  ];
  const complete =
    firstTestBeforeProduction &&
    red !== undefined &&
    green !== undefined &&
    fullGreen !== undefined;
  const validity = reasons.length > 0 ? "invalid" : !loaded || complete ? "valid" : "insufficient";
  return {
    activation: loaded ? ("activated" as const) : ("not_activated" as const),
    validity,
    first_test_before_production: firstTestBeforeProduction,
    focused_red: red !== undefined,
    focused_green: green !== undefined,
    full_suite_green: fullGreen !== undefined,
    refactor_after_green: refactorAfterGreen,
    reason_codes: reasons,
  };
}
