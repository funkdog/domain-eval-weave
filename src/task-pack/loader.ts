import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const taskPackSchema = z.strictObject({
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
  oracle_version: z.literal("ledger-oracle-v3"),
  calibration_digest: sha256Schema,
});

export type TaskPack = z.infer<typeof taskPackSchema>;

const taskPackIdentitySchema = z.strictObject({
  schema_version: z.literal(1),
  pack: taskPackSchema,
  public_task_sha256: sha256Schema,
  oracle_runner_sha256: sha256Schema,
});

export type TaskPackIdentity = z.infer<typeof taskPackIdentitySchema>;

export async function digestDirectory(root: string): Promise<string> {
  const absoluteRoot = resolve(root);
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
      } else if (stat.isFile()) {
        entries.push({ path: relativePath, sha256: sha256Hex(await readFile(path)) });
      } else {
        throw new Error(`directory digest rejects special entry: ${relativePath}`);
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
  const decoded = JSON.parse(await readFile(resolve(packRoot, "pack.json"), "utf8"));
  const pack = taskPackSchema.parse(decoded);
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
  await readFile(publicTaskPath);
  return pack;
}

export async function loadTaskPackIdentity(packRoot: string): Promise<TaskPackIdentity> {
  const pack = await loadTaskPack(packRoot);
  const [publicTask, oracleRunner] = await Promise.all([
    readFile(resolve(packRoot, pack.public_task_ref)),
    readFile(resolve(packRoot, "oracle/runner.mjs")),
  ]);
  return taskPackIdentitySchema.parse({
    schema_version: 1,
    pack,
    public_task_sha256: sha256Hex(publicTask),
    oracle_runner_sha256: sha256Hex(oracleRunner),
  });
}

export function parseTaskPackIdentity(input: unknown): TaskPackIdentity {
  return taskPackIdentitySchema.parse(input);
}
