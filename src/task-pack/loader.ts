import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";
import { type ObservationCatalog, parseObservationCatalog } from "../delivery/contracts.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const frozenTaskPackSchema = z.strictObject({
  schema_version: z.literal(1),
  task_id: z.literal("open-coding-ts-ledger-v1"),
  eval_pack_id: z.literal("open-coding-delivery-v1"),
  base_tree_sha256: sha256Schema,
  public_task_ref: z.literal("public-task.md"),
  allowed_candidate_globs: z.tuple([z.literal("src/**")]),
  forbidden_entry_types: z.tuple([z.literal("symlink"), z.literal("submodule")]),
  public_test_command: z.tuple([
    z.literal("node"),
    z.literal("--test"),
    z.literal("test/public/*.test.ts"),
  ]),
  oracle_version: z.enum(["ledger-oracle-v2", "ledger-oracle-v3"]),
  calibration_digest: sha256Schema,
});

const currentTaskPackSchema = frozenTaskPackSchema.extend({
  oracle_version: z.literal("ledger-oracle-v3"),
});

export type TaskPack = z.infer<typeof frozenTaskPackSchema>;

const taskPackIdentitySchema = z.strictObject({
  schema_version: z.literal(1),
  pack: frozenTaskPackSchema,
  public_task_sha256: sha256Schema,
  oracle_runner_sha256: sha256Schema,
  observation_catalog_sha256: sha256Schema.optional(),
});

export type TaskPackIdentity = z.infer<typeof taskPackIdentitySchema>;

function contained(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function assertPhysicalDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(path)) !== path) {
    throw new Error("Task Pack root must be a physical directory");
  }
}

async function readPhysicalPackFile(packRoot: string, relativePath: string): Promise<Buffer> {
  const root = resolve(packRoot);
  await assertPhysicalDirectory(root);
  const target = resolve(root, relativePath);
  if (!contained(root, target)) throw new Error("Task Pack ref escapes root");
  let current = root;
  for (const segment of relative(root, target).split("/")) {
    current = resolve(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error("Task Pack ref crosses a symlink");
  }
  const entry = await lstat(target);
  if (!entry.isFile() || entry.nlink !== 1 || (await realpath(target)) !== target) {
    throw new Error("Task Pack ref must be a single-link physical file");
  }
  return readFile(target);
}

export async function digestDirectory(root: string): Promise<string> {
  const absoluteRoot = resolve(root);
  await assertPhysicalDirectory(absoluteRoot);
  const entries: { path: string; sha256: string }[] = [];
  const visit = async (directory: string): Promise<void> => {
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const path = resolve(directory, name);
      const stat = await lstat(path);
      const relativePath = relative(absoluteRoot, path).split("\\").join("/");
      if (stat.isSymbolicLink())
        throw new Error(`directory digest rejects symlink: ${relativePath}`);
      if (stat.isDirectory()) {
        await visit(path);
      } else if (stat.isFile() && stat.nlink === 1 && (await realpath(path)) === path) {
        entries.push({ path: relativePath, sha256: sha256Hex(await readFile(path)) });
      } else {
        throw new Error(`directory digest rejects non-physical entry: ${relativePath}`);
      }
    }
  };
  await visit(absoluteRoot);
  return sha256Hex(canonicalJson(entries));
}

export async function digestTaskPack(packRoot: string): Promise<string> {
  if (!isAbsolute(packRoot)) throw new Error("Task Pack root must be absolute");
  return sha256Hex(canonicalJson(await loadTaskPackIdentity(packRoot)));
}

export async function loadTaskPack(packRoot: string): Promise<TaskPack> {
  if (!isAbsolute(packRoot)) throw new Error("Task Pack root must be absolute");
  const decoded = JSON.parse((await readPhysicalPackFile(packRoot, "pack.json")).toString("utf8"));
  const pack = currentTaskPackSchema.parse(decoded);
  const [baseDigest, calibrationDigest] = await Promise.all([
    digestDirectory(resolve(packRoot, "base")),
    digestDirectory(resolve(packRoot, "calibration")),
  ]);
  if (pack.base_tree_sha256 !== baseDigest || pack.calibration_digest !== calibrationDigest) {
    throw new Error("Task Pack content digest mismatch");
  }
  const publicTaskPath = resolve(packRoot, pack.public_task_ref);
  const relation = relative(resolve(packRoot), publicTaskPath);
  if (relation.startsWith("..") || isAbsolute(relation))
    throw new Error("Task Pack ref escapes root");
  await readPhysicalPackFile(packRoot, pack.public_task_ref);
  return pack;
}

export async function loadTaskPackIdentity(packRoot: string): Promise<TaskPackIdentity> {
  const pack = await loadTaskPack(packRoot);
  const [publicTask, oracleRunner, observationCatalog] = await Promise.all([
    readPhysicalPackFile(packRoot, pack.public_task_ref),
    readPhysicalPackFile(packRoot, "oracle/runner.mjs"),
    loadObservationCatalog(packRoot),
  ]);
  return taskPackIdentitySchema.parse({
    schema_version: 1,
    pack,
    public_task_sha256: sha256Hex(publicTask),
    oracle_runner_sha256: sha256Hex(oracleRunner),
    observation_catalog_sha256: sha256Hex(canonicalJson(observationCatalog)),
  });
}

export async function loadObservationCatalog(packRoot: string): Promise<ObservationCatalog> {
  if (!isAbsolute(packRoot)) throw new Error("Task Pack root must be absolute");
  const source = (await readPhysicalPackFile(packRoot, "claim-observation-catalog.json")).toString(
    "utf8",
  );
  const catalog = parseObservationCatalog(JSON.parse(source));
  const pack = await loadTaskPack(packRoot);
  if (catalog.task_id !== pack.task_id || catalog.oracle_version !== pack.oracle_version) {
    throw new Error("observation catalog identity does not match the frozen Task Pack");
  }
  return catalog;
}

export function parseTaskPackIdentity(input: unknown): TaskPackIdentity {
  return taskPackIdentitySchema.parse(input);
}
