import { lstat, mkdir, open, readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { type CapsuleRelease, capsuleReleaseSchema, parseCapsuleRelease } from "./contracts.js";
import { CapsuleError, type LoadedCapsule, loadCapsule } from "./loader.js";

export interface ReleasedCapsule {
  readonly release: CapsuleRelease;
  readonly sha256: string;
  readonly ref: string;
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
}

async function collectDirectory(root: string, relativeDirectory: string): Promise<string[]> {
  const directory = resolve(root, relativeDirectory);
  const physicalRoot = await realpath(root);
  const results: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      const relativePath = relative(root, absolute).split("\\").join("/");
      if (relativePath === ".eval" || relativePath.startsWith(".eval/")) continue;
      if (entry.isSymbolicLink()) {
        throw new CapsuleError(
          "CAPSULE_SYMLINK_DENIED",
          "Candidate directories cannot contain symlinks",
          relativePath,
        );
      }
      const physical = await realpath(absolute);
      if (!contained(physicalRoot, physical)) {
        throw new CapsuleError(
          "CAPSULE_PATH_ESCAPE",
          "Candidate path resolves outside Capsule root",
          relativePath,
        );
      }
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) results.push(relativePath);
      else {
        throw new CapsuleError(
          "CAPSULE_PATH_TYPE_INVALID",
          "Capsule release accepts only physical files and directories",
          relativePath,
        );
      }
    }
  };
  await walk(directory);
  return results;
}

async function releasePaths(capsule: LoadedCapsule): Promise<string[]> {
  const declared = [
    capsule.paths.manifest,
    capsule.paths.domain,
    ...capsule.manifest.sources.map((source) => source.path),
    ...capsule.paths.requirements,
    ...capsule.paths.evaluators,
    ...capsule.paths.cases,
  ];
  for (const candidate of capsule.manifest.candidates) {
    declared.push(...(await collectDirectory(capsule.root, candidate.path)));
  }
  return [...new Set(declared)].sort();
}

async function buildRelease(capsule: LoadedCapsule): Promise<CapsuleRelease> {
  const entries = [];
  for (const path of await releasePaths(capsule)) {
    const absolute = resolve(capsule.root, path);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new CapsuleError("CAPSULE_PATH_TYPE_INVALID", "Release entry must be a file", path);
    }
    const bytes = await readFile(absolute);
    entries.push({ path, sha256: sha256Hex(bytes), size: bytes.byteLength });
  }
  return capsuleReleaseSchema.parse({
    schema_version: 1,
    capsule_id: capsule.manifest.capsule_id,
    capsule_version: capsule.manifest.version,
    entries,
    derived: {
      claims: capsule.domain.claims.map((claim) => claim.claim_id).sort(),
      requirement_edges: capsule.requirements
        .flatMap((requirement) =>
          requirement.edges.map((edge) => ({
            requirement_id: requirement.requirement_id,
            claim_id: edge.claim_id,
            relation: edge.relation,
            required: edge.required,
          })),
        )
        .sort((left, right) =>
          `${left.requirement_id}:${left.claim_id}:${left.relation}`.localeCompare(
            `${right.requirement_id}:${right.claim_id}:${right.relation}`,
          ),
        ),
    },
  });
}

async function writeExclusiveOrVerify(path: string, bytes: Uint8Array): Promise<void> {
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(bytes))) {
      throw new CapsuleError(
        "CAPSULE_RELEASE_COLLISION",
        "Existing release path contains different bytes",
        path,
      );
    }
  }
}

export async function releaseCapsule(root: string): Promise<ReleasedCapsule> {
  const capsule = await loadCapsule(root);
  const release = await buildRelease(capsule);
  const sha256 = canonicalJsonDigest(release);
  const ref = `.eval/releases/${sha256}.json`;
  const output = resolve(capsule.root, ref);
  await mkdir(resolve(capsule.root, ".eval/releases"), { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(output, Buffer.from(`${canonicalJson(release)}\n`, "utf8"));
  return { release, sha256, ref };
}

export async function readCapsuleRelease(rootInput: string, ref: string): Promise<CapsuleRelease> {
  if (!/^\.eval\/releases\/[0-9a-f]{64}\.json$/.test(ref)) {
    throw new CapsuleError("CAPSULE_RELEASE_REF_INVALID", "Release ref is invalid", ref);
  }
  const root = resolve(rootInput);
  const release = parseCapsuleRelease(JSON.parse(await readFile(resolve(root, ref), "utf8")));
  const expectedDigest = ref.slice(".eval/releases/".length, -".json".length);
  if (canonicalJsonDigest(release) !== expectedDigest) {
    throw new CapsuleError("CAPSULE_RELEASE_DRIFT", "Release digest drifted", ref);
  }
  for (const entry of release.entries) {
    const absolute = resolve(root, entry.path);
    if (!contained(root, absolute)) {
      throw new CapsuleError(
        "CAPSULE_PATH_ESCAPE",
        "Release entry escapes Capsule root",
        entry.path,
      );
    }
    const stat = await lstat(absolute).catch(() => undefined);
    if (stat === undefined || !stat.isFile() || stat.isSymbolicLink()) {
      throw new CapsuleError("CAPSULE_RELEASE_DRIFT", "Release entry is missing", entry.path);
    }
    const bytes = await readFile(absolute);
    if (bytes.byteLength !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      throw new CapsuleError("CAPSULE_RELEASE_DRIFT", "Release entry bytes drifted", entry.path);
    }
  }
  const rebuilt = await buildRelease(await loadCapsule(root));
  if (canonicalJson(rebuilt) !== canonicalJson(release)) {
    throw new CapsuleError(
      "CAPSULE_RELEASE_DRIFT",
      "Capsule closure contains missing, extra, or changed release inputs",
      ref,
    );
  }
  return release;
}
