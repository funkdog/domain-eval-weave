import { copyFile, cp, lstat, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import {
  type EvalPack,
  type HarnessManifest,
  packageRelativeRefSchema,
  parseEvalPack,
  parseHarnessManifest,
  parseRegistry,
  parseTaskEntry,
  type Registry,
  type TaskEntry,
} from "../contracts/phase2.js";
import { digestDirectory } from "../task-pack/loader.js";

export class StaticBindingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StaticBindingError";
    this.code = code;
  }
}

export interface StaticEvalBinding {
  readonly packageRoot: string;
  readonly harness: HarnessManifest;
  readonly registry: Registry;
  readonly evalPack: EvalPack;
  readonly tasks: readonly TaskEntry[];
  readonly digests: {
    readonly harness: string;
    readonly registry: string;
    readonly evalPack: string;
    readonly tasks: Readonly<Record<string, string>>;
  };
}

function isPathInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function physicalDirectory(path: string, code: string): Promise<string> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(path);
  } catch {
    throw new StaticBindingError(code, `directory does not exist: ${path}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new StaticBindingError(code, `directory must be a physical directory: ${path}`);
  }
  return realpath(path);
}

async function packageRootPath(packageRoot: string): Promise<string> {
  if (!isAbsolute(packageRoot)) {
    throw new StaticBindingError("PACKAGE_ROOT_NOT_ABSOLUTE", "package root must be absolute");
  }
  return physicalDirectory(resolve(packageRoot), "PACKAGE_ROOT_INVALID");
}

async function resolvePhysicalPackageRef(
  root: string,
  inputRef: unknown,
  kind: "file" | "directory",
): Promise<string> {
  const ref = packageRelativeRefSchema.parse(inputRef);
  const candidate = resolve(root, ref);
  if (!isPathInside(root, candidate)) {
    throw new StaticBindingError("PACKAGE_REF_ESCAPE", `package ref escapes root: ${ref}`);
  }

  let current = root;
  for (const [index, segment] of ref.split("/").entries()) {
    current = resolve(current, segment);
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(current);
    } catch {
      throw new StaticBindingError("PACKAGE_REF_MISSING", `package ref does not exist: ${ref}`);
    }
    if (stat.isSymbolicLink()) {
      throw new StaticBindingError("PACKAGE_REF_SYMLINK", `package ref contains a symlink: ${ref}`);
    }
    const final = index === ref.split("/").length - 1;
    if (!final && !stat.isDirectory()) {
      throw new StaticBindingError(
        "PACKAGE_REF_PARENT_INVALID",
        `package ref parent is not a directory: ${ref}`,
      );
    }
    if (final && (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
      throw new StaticBindingError(
        "PACKAGE_REF_TYPE_INVALID",
        `package ref has wrong type: ${ref}`,
      );
    }
  }

  const physical = await realpath(candidate);
  if (!isPathInside(root, physical)) {
    throw new StaticBindingError("PACKAGE_REF_ESCAPE", `package ref resolves outside root: ${ref}`);
  }
  return physical;
}

async function readJson<T>(
  root: string,
  ref: unknown,
  parse: (value: unknown) => T,
): Promise<{ readonly value: T; readonly digest: string }> {
  const path = await resolvePhysicalPackageRef(root, ref, "file");
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new StaticBindingError(
      "STATIC_JSON_INVALID",
      `static JSON is unreadable: ${String(ref)}`,
    );
  }
  const value = parse(decoded);
  return { value, digest: canonicalJsonDigest(value) };
}

async function directoryFileDigests(
  root: string,
  directoryRef: string,
): Promise<Map<string, string>> {
  const directory = await resolvePhysicalPackageRef(root, directoryRef, "directory");
  const result = new Map<string, string>();
  const visit = async (current: string): Promise<void> => {
    for (const name of (await readdir(current)).sort()) {
      const path = resolve(current, name);
      const stat = await lstat(path);
      const ref = relative(directory, path).split("\\").join("/");
      if (stat.isSymbolicLink()) {
        throw new StaticBindingError("BASE_ENTRY_SYMLINK", `base contains a symlink: ${ref}`);
      }
      if (stat.isDirectory()) await visit(path);
      else if (stat.isFile()) result.set(ref, sha256Hex(await readFile(path)));
      else {
        throw new StaticBindingError("BASE_ENTRY_SPECIAL", `base contains a special entry: ${ref}`);
      }
    }
  };
  await visit(directory);
  return result;
}

async function effectiveBaseDigest(root: string, task: TaskEntry): Promise<string> {
  const entries = await directoryFileDigests(root, task.base_ref);
  for (const overlay of task.overlays) {
    if (!entries.has(overlay.target_ref)) {
      throw new StaticBindingError(
        "OVERLAY_TARGET_MISSING",
        `overlay target is not present in base: ${overlay.target_ref}`,
      );
    }
    const source = await resolvePhysicalPackageRef(root, overlay.source_ref, "file");
    entries.set(overlay.target_ref, sha256Hex(await readFile(source)));
  }
  return sha256Hex(
    canonicalJson(
      [...entries.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([path, sha256]) => ({ path, sha256 })),
    ),
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && [...left].sort().join("\n") === [...right].sort().join("\n")
  );
}

function taskBucket(pack: EvalPack, taskId: string): TaskEntry["bucket"] | undefined {
  if (pack.buckets.trigger.includes(taskId)) return "trigger";
  if (pack.buckets.non_trigger.includes(taskId)) return "non-trigger";
  if (pack.buckets.holdout.includes(taskId)) return "holdout";
  return undefined;
}

export async function loadStaticEvalBinding(packageRoot: string): Promise<StaticEvalBinding> {
  const root = await packageRootPath(packageRoot);
  const harnessDocument = await readJson(
    root,
    "harnesses/dsh-goal-stack/harness.json",
    parseHarnessManifest,
  );
  const registryDocument = await readJson(
    root,
    harnessDocument.value.eval_binding.registry_ref,
    parseRegistry,
  );
  if (harnessDocument.value.eval_binding.registry_sha256 !== registryDocument.digest) {
    throw new StaticBindingError("REGISTRY_DIGEST_MISMATCH", "Harness registry digest mismatch");
  }

  const evalPackPointer = registryDocument.value.eval_packs.find(
    (pointer) => pointer.id === harnessDocument.value.eval_binding.eval_pack_id,
  );
  if (evalPackPointer === undefined || registryDocument.value.eval_packs.length !== 1) {
    throw new StaticBindingError(
      "EVAL_PACK_BINDING_INVALID",
      "Harness eval pack must have exactly one Registry pointer",
    );
  }
  const evalPackDocument = await readJson(root, evalPackPointer.ref, parseEvalPack);
  if (
    evalPackDocument.value.eval_pack_id !== evalPackPointer.id ||
    evalPackDocument.value.harness_id !== harnessDocument.value.harness_id ||
    evalPackDocument.digest !== evalPackPointer.sha256
  ) {
    throw new StaticBindingError(
      "EVAL_PACK_DIGEST_MISMATCH",
      "Eval Pack binding or digest mismatch",
    );
  }
  if (
    !sameSet(
      evalPackDocument.value.task_ids,
      registryDocument.value.tasks.map((pointer) => pointer.id),
    )
  ) {
    throw new StaticBindingError(
      "TASK_POINTER_SET_INVALID",
      "Registry Task pointers must exactly match the Eval Pack",
    );
  }

  const tasks: TaskEntry[] = [];
  const taskDigests: Record<string, string> = {};
  for (const pointer of registryDocument.value.tasks) {
    const taskDocument = await readJson(root, pointer.ref, parseTaskEntry);
    const task = taskDocument.value;
    if (
      task.task_id !== pointer.id ||
      taskDocument.digest !== pointer.sha256 ||
      task.bucket !== taskBucket(evalPackDocument.value, task.task_id)
    ) {
      throw new StaticBindingError(
        "TASK_DIGEST_MISMATCH",
        `Task binding or digest mismatch: ${pointer.id}`,
      );
    }
    const [publicTask, oracleRunner, baseDigest] = await Promise.all([
      resolvePhysicalPackageRef(root, task.public_task_ref, "file").then((path) => readFile(path)),
      resolvePhysicalPackageRef(root, task.oracle.runner_ref, "file").then((path) =>
        readFile(path),
      ),
      effectiveBaseDigest(root, task),
    ]);
    if (
      sha256Hex(publicTask) !== task.public_task_sha256 ||
      sha256Hex(oracleRunner) !== task.oracle.runner_sha256 ||
      baseDigest !== task.effective_base_sha256
    ) {
      throw new StaticBindingError(
        "TASK_CONTENT_DIGEST_MISMATCH",
        `Task content digest mismatch: ${pointer.id}`,
      );
    }
    tasks.push(task);
    taskDigests[task.task_id] = taskDocument.digest;
  }

  const sharedOracle = canonicalJson(tasks[0]?.oracle);
  if (tasks.some((task) => canonicalJson(task.oracle) !== sharedOracle)) {
    throw new StaticBindingError(
      "TASK_PROTOCOL_MISMATCH",
      "all Eval Pack tasks must share one Oracle protocol",
    );
  }

  return {
    packageRoot: root,
    harness: harnessDocument.value,
    registry: registryDocument.value,
    evalPack: evalPackDocument.value,
    tasks,
    digests: {
      harness: harnessDocument.digest,
      registry: registryDocument.digest,
      evalPack: evalPackDocument.digest,
      tasks: taskDigests,
    },
  };
}

export async function materializeRegistryTask(input: {
  readonly packageRoot: string;
  readonly task: TaskEntry;
  readonly destination: string;
}): Promise<void> {
  const root = await packageRootPath(input.packageRoot);
  const destination = resolve(input.destination);
  if (!isAbsolute(input.destination)) {
    throw new StaticBindingError(
      "MATERIALIZATION_ROOT_NOT_ABSOLUTE",
      "materialization destination must be absolute",
    );
  }
  await physicalDirectory(dirname(destination), "MATERIALIZATION_PARENT_INVALID");
  try {
    await lstat(destination);
    throw new StaticBindingError(
      "MATERIALIZATION_EXISTS",
      "materialization destination must not already exist",
    );
  } catch (error) {
    if (error instanceof StaticBindingError || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const base = await resolvePhysicalPackageRef(root, input.task.base_ref, "directory");
  try {
    await cp(base, destination, { recursive: true, force: false, errorOnExist: true });
    await mkdir(destination, { recursive: false, mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    for (const overlay of input.task.overlays) {
      const source = await resolvePhysicalPackageRef(root, overlay.source_ref, "file");
      const target = resolve(destination, overlay.target_ref);
      if (!isPathInside(destination, target)) {
        throw new StaticBindingError("OVERLAY_TARGET_ESCAPE", "overlay target escapes workspace");
      }
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw new StaticBindingError(
          "OVERLAY_TARGET_INVALID",
          `overlay target is not a regular base file: ${overlay.target_ref}`,
        );
      }
      await copyFile(source, target);
    }
    if ((await digestDirectory(destination)) !== input.task.effective_base_sha256) {
      throw new StaticBindingError(
        "MATERIALIZATION_DIGEST_MISMATCH",
        `materialized Task digest mismatch: ${input.task.task_id}`,
      );
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
