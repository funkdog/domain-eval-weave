import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";

import { type ArtifactRef, artifactRefPath, parseArtifactRef } from "./artifact-ref.js";
import { canonicalJson, sha256Hex } from "./canonical-json.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type { ArtifactRef } from "./artifact-ref.js";
export { parseArtifactRef } from "./artifact-ref.js";

export interface ArtifactPointer {
  readonly ref: ArtifactRef;
  readonly sha256: string;
}

export class ArtifactIntegrityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
    this.code = code;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

function parsePointer(pointer: {
  readonly ref: unknown;
  readonly sha256: unknown;
}): ArtifactPointer {
  if (typeof pointer.sha256 !== "string" || !SHA256_PATTERN.test(pointer.sha256)) {
    throw new ArtifactIntegrityError(
      "ARTIFACT_DIGEST_INVALID",
      "artifact pointer has an invalid SHA-256 digest",
    );
  }
  return { ref: parseArtifactRef(pointer.ref), sha256: pointer.sha256 };
}

async function assertCampaignRoot(campaignRoot: string): Promise<string> {
  if (!isAbsolute(campaignRoot)) {
    throw new ArtifactIntegrityError(
      "CAMPAIGN_ROOT_NOT_ABSOLUTE",
      "campaign root must be absolute",
    );
  }

  const rootPath = resolve(campaignRoot);
  const rootStat = await lstat(rootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ArtifactIntegrityError(
      "CAMPAIGN_ROOT_INVALID",
      "campaign root must be a real directory",
    );
  }
  return realpath(rootPath);
}

export function resolveArtifactRef(campaignRoot: string, input: unknown): string {
  if (!isAbsolute(campaignRoot)) {
    throw new ArtifactIntegrityError(
      "CAMPAIGN_ROOT_NOT_ABSOLUTE",
      "campaign root must be absolute",
    );
  }

  const root = resolve(campaignRoot);
  const ref = parseArtifactRef(input);
  const candidate = resolve(root, artifactRefPath(ref));
  if (!isPathInside(root, candidate)) {
    throw new ArtifactIntegrityError(
      "ARTIFACT_PATH_ESCAPE",
      "artifact ref resolves outside its Campaign root",
    );
  }
  return candidate;
}

async function assertReadableRegularArtifact(
  campaignRoot: string,
  ref: ArtifactRef,
): Promise<string> {
  const realRoot = await assertCampaignRoot(campaignRoot);
  const artifactPath = resolveArtifactRef(campaignRoot, ref);
  const artifactStat = await lstat(artifactPath);
  if (artifactStat.isSymbolicLink() || !artifactStat.isFile() || artifactStat.nlink !== 1) {
    throw new ArtifactIntegrityError(
      "ARTIFACT_ENTRY_INVALID",
      "artifact must be a single-link regular file",
    );
  }

  const realArtifact = await realpath(artifactPath);
  if (!isPathInside(realRoot, realArtifact)) {
    throw new ArtifactIntegrityError(
      "ARTIFACT_SYMLINK_ESCAPE",
      "artifact resolves outside its Campaign root",
    );
  }
  return realArtifact;
}

async function prepareArtifactParent(campaignRoot: string, ref: ArtifactRef): Promise<void> {
  const realRoot = await assertCampaignRoot(campaignRoot);
  const rootPath = resolve(campaignRoot);
  const segments = artifactRefPath(ref).split("/");
  const directorySegments = segments.slice(0, -1);
  let currentPath = rootPath;

  for (const segment of directorySegments) {
    currentPath = resolve(currentPath, segment);
    let needsCreation = false;
    try {
      await lstat(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      needsCreation = true;
    }

    if (needsCreation) {
      try {
        await mkdir(currentPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }

    let entryStat: Awaited<ReturnType<typeof lstat>>;
    try {
      entryStat = await lstat(currentPath);
    } catch {
      throw new ArtifactIntegrityError(
        "ARTIFACT_PARENT_INVALID",
        "artifact parent could not be revalidated",
      );
    }
    if (entryStat.isSymbolicLink() || !entryStat.isDirectory()) {
      throw new ArtifactIntegrityError(
        "ARTIFACT_PARENT_INVALID",
        "artifact parent must contain only real directories",
      );
    }

    const realCurrentPath = await realpath(currentPath);
    if (!isPathInside(realRoot, realCurrentPath)) {
      throw new ArtifactIntegrityError(
        "ARTIFACT_SYMLINK_ESCAPE",
        "artifact parent resolves outside its Campaign root",
      );
    }
  }
}

export async function writeCanonicalJsonArtifact(
  campaignRoot: string,
  inputRef: unknown,
  value: unknown,
): Promise<ArtifactPointer> {
  return writeArtifactBytes(campaignRoot, inputRef, canonicalJson(value));
}

async function assertExistingArtifactMatches(
  campaignRoot: string,
  ref: ArtifactRef,
  expectedBytes: Buffer,
): Promise<void> {
  let existingBytes: Buffer;
  try {
    const artifactPath = await assertReadableRegularArtifact(campaignRoot, ref);
    existingBytes = await readFile(artifactPath);
  } catch (error) {
    if (error instanceof ArtifactIntegrityError) throw error;
    throw new ArtifactIntegrityError("ARTIFACT_UNREADABLE", "existing artifact could not be read");
  }

  if (!existingBytes.equals(expectedBytes)) {
    throw new ArtifactIntegrityError(
      "ARTIFACT_ALREADY_EXISTS",
      "artifact ref is already frozen with different bytes",
    );
  }
}

export async function writeArtifactBytes(
  campaignRoot: string,
  inputRef: unknown,
  value: string | Uint8Array,
): Promise<ArtifactPointer> {
  const ref = parseArtifactRef(inputRef);
  const artifactPath = resolveArtifactRef(campaignRoot, ref);
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  const temporaryPath = `${artifactPath}.tmp-${randomUUID()}`;

  await prepareArtifactParent(campaignRoot, ref);
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(temporaryPath, artifactPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await assertExistingArtifactMatches(campaignRoot, ref, bytes);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return { ref, sha256: sha256Hex(bytes) };
}

export async function readArtifactBytes(
  campaignRoot: string,
  inputPointer: { readonly ref: unknown; readonly sha256: unknown },
): Promise<Buffer> {
  const pointer = parsePointer(inputPointer);
  let artifactPath: string;
  try {
    artifactPath = await assertReadableRegularArtifact(campaignRoot, pointer.ref);
  } catch (error) {
    if (error instanceof ArtifactIntegrityError) throw error;
    throw new ArtifactIntegrityError("ARTIFACT_UNREADABLE", "artifact could not be read");
  }

  const bytes = await readFile(artifactPath);
  if (sha256Hex(bytes) !== pointer.sha256) {
    throw new ArtifactIntegrityError(
      "ARTIFACT_DIGEST_MISMATCH",
      "artifact content does not match its recorded digest",
    );
  }
  return bytes;
}

export async function readArtifactBytesByRef(
  campaignRoot: string,
  inputRef: unknown,
): Promise<{ readonly pointer: ArtifactPointer; readonly bytes: Buffer }> {
  const ref = parseArtifactRef(inputRef);
  let artifactPath: string;
  try {
    artifactPath = await assertReadableRegularArtifact(campaignRoot, ref);
  } catch (error) {
    if (error instanceof ArtifactIntegrityError) throw error;
    throw new ArtifactIntegrityError("ARTIFACT_UNREADABLE", "artifact could not be read");
  }
  const bytes = await readFile(artifactPath);
  return { pointer: { ref, sha256: sha256Hex(bytes) }, bytes };
}

export async function readJsonArtifact<T>(
  campaignRoot: string,
  inputPointer: { readonly ref: unknown; readonly sha256: unknown },
  parser: (input: unknown) => T,
): Promise<T> {
  const bytes = await readArtifactBytes(campaignRoot, inputPointer);

  let decoded: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    decoded = JSON.parse(text);
  } catch {
    throw new ArtifactIntegrityError("ARTIFACT_JSON_INVALID", "artifact is not valid UTF-8 JSON");
  }

  if (canonicalJson(decoded) !== text) {
    throw new ArtifactIntegrityError(
      "ARTIFACT_JSON_NON_CANONICAL",
      "JSON artifact bytes are not in canonical form",
    );
  }

  try {
    return parser(decoded);
  } catch {
    throw new ArtifactIntegrityError(
      "ARTIFACT_CONTRACT_INVALID",
      "artifact JSON does not satisfy its contract",
    );
  }
}
