import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { canonicalJson, sha256Hex } from "./canonical-json.js";
import {
  parseSuiteArtifactRef,
  type SuiteArtifactRef,
  suiteArtifactRefPath,
} from "./suite-artifact-ref.js";

export interface SuiteArtifactPointer {
  readonly ref: SuiteArtifactRef;
  readonly sha256: string;
}

export class SuiteArtifactIntegrityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SuiteArtifactIntegrityError";
    this.code = code;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function physicalRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) {
    throw new SuiteArtifactIntegrityError("SUITE_ROOT_NOT_ABSOLUTE", "Suite root must be absolute");
  }
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SuiteArtifactIntegrityError("SUITE_ROOT_INVALID", "Suite root must be physical");
  }
  return realpath(root);
}

async function prepareParent(root: string, ref: SuiteArtifactRef): Promise<void> {
  const realRoot = await physicalRoot(root);
  let current = resolve(root);
  for (const segment of suiteArtifactRefPath(ref).split("/").slice(0, -1)) {
    current = resolve(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new SuiteArtifactIntegrityError(
        "SUITE_ARTIFACT_PARENT_INVALID",
        "Suite artifact parent must be physical",
      );
    }
    if (!isPathInside(realRoot, await realpath(current))) {
      throw new SuiteArtifactIntegrityError(
        "SUITE_ARTIFACT_ESCAPE",
        "Suite artifact parent escapes root",
      );
    }
  }
}

function pathFor(root: string, ref: SuiteArtifactRef): string {
  const path = resolve(root, suiteArtifactRefPath(ref));
  if (!isPathInside(resolve(root), path)) {
    throw new SuiteArtifactIntegrityError("SUITE_ARTIFACT_ESCAPE", "Suite artifact escapes root");
  }
  return path;
}

async function existingBytes(root: string, ref: SuiteArtifactRef): Promise<Buffer> {
  const realRoot = await physicalRoot(root);
  const path = pathFor(root, ref);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_ENTRY_INVALID",
      "Suite artifact must be a physical file",
    );
  }
  if (!isPathInside(realRoot, await realpath(path))) {
    throw new SuiteArtifactIntegrityError("SUITE_ARTIFACT_ESCAPE", "Suite artifact escapes root");
  }
  return readFile(path);
}

export async function writeSuiteArtifactBytes(
  root: string,
  inputRef: unknown,
  value: string | Uint8Array,
): Promise<SuiteArtifactPointer> {
  const ref = parseSuiteArtifactRef(inputRef);
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  await prepareParent(root, ref);
  const path = pathFor(root, ref);
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await existingBytes(root, ref)).equals(bytes)) {
        throw new SuiteArtifactIntegrityError(
          "SUITE_ARTIFACT_ALREADY_EXISTS",
          "Suite artifact is already frozen with different bytes",
        );
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return { ref, sha256: sha256Hex(bytes) };
}

export function writeCanonicalSuiteArtifact(
  root: string,
  ref: unknown,
  value: unknown,
): Promise<SuiteArtifactPointer> {
  return writeSuiteArtifactBytes(root, ref, canonicalJson(value));
}

export async function readSuiteArtifactBytes(
  root: string,
  pointer: { readonly ref: unknown; readonly sha256: unknown },
): Promise<Buffer> {
  const ref = parseSuiteArtifactRef(pointer.ref);
  if (typeof pointer.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(pointer.sha256)) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_DIGEST_INVALID",
      "Suite artifact digest is invalid",
    );
  }
  const bytes = await existingBytes(root, ref);
  if (sha256Hex(bytes) !== pointer.sha256) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_DIGEST_MISMATCH",
      "Suite artifact digest mismatch",
    );
  }
  return bytes;
}

export async function readSuiteArtifactBytesByRef(
  root: string,
  inputRef: unknown,
): Promise<{ readonly pointer: SuiteArtifactPointer; readonly bytes: Buffer }> {
  const ref = parseSuiteArtifactRef(inputRef);
  const bytes = await existingBytes(root, ref);
  return { pointer: { ref, sha256: sha256Hex(bytes) }, bytes };
}

export async function readCanonicalSuiteArtifact<T>(
  root: string,
  pointer: { readonly ref: unknown; readonly sha256: unknown },
  parse: (value: unknown) => T,
): Promise<T> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    await readSuiteArtifactBytes(root, pointer),
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_JSON_INVALID",
      "Suite artifact is not JSON",
    );
  }
  let value: T;
  try {
    value = parse(decoded);
  } catch {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_SCHEMA_INVALID",
      "Suite artifact does not match its frozen schema",
    );
  }
  if (canonicalJson(value) !== text) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_NOT_CANONICAL",
      "Suite artifact is not canonical JSON",
    );
  }
  return value;
}
