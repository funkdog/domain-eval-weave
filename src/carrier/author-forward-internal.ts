import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  FORWARD_RUN_NONCE_ENV,
  FORWARD_RUN_ROOT_ENV,
  ForwardEvidenceStore,
  type ForwardFixtureManifest,
  type ForwardIndependentLabelManifest,
  type ForwardRunHandle,
  type ForwardRunProjection,
  type ForwardRunReceipt,
  forwardFixtureManifestSchema,
  forwardIndependentLabelManifestSchema,
  readForwardEvidenceRoot,
} from "../author-evidence/index.js";
import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { parseDomainEvidenceCard } from "../domain/contracts.js";
import { fingerprintPackageEntries } from "../fingerprint/deployment.js";
import { PHASE2_INSTANCE, PHASE3A_AUTHOR } from "../instance.js";
import { assertSecretFreeText, isCredentialPathSegment } from "../report/secret-scan.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../runtime-root.js";
import { verifyAuthorForwardProductionRuntime } from "./author-forward-production.js";

export const FORWARD_MAX_OUTPUT_BYTES = 1024 * 1024;
export const FORWARD_POST_OUTPUT_EXIT_GRACE_MS = 5_000;
export const FORWARD_ERROR_MARKERS = [
  "PI_AI_ERROR",
  "PI_AUTH_ERROR",
  "PI_MODEL_ERROR",
  "PI_SDK_ERROR",
] as const;
export const FORWARD_MODEL_ROUTE = {
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  effort: "xhigh",
} as const;
const MAX_PACKAGE_TAR_BYTES = 64 * 1024 * 1024;

export const FORWARD_ACCEPTANCE_ROOT = `${DEDICATED_RUNTIME_ROOT}/phase3a-forward-acceptance`;
export const FORWARD_FIXTURES_ROOT = `${FORWARD_ACCEPTANCE_ROOT}/fixtures`;
export const FORWARD_LABELS_ROOT = `${FORWARD_ACCEPTANCE_ROOT}/labels`;
export const FORWARD_PACKAGES_ROOT = `${FORWARD_ACCEPTANCE_ROOT}/packages`;
export const FORWARD_FIXTURE_MANIFEST = ".dsh-eval-forward-fixture.json";
export const FORWARD_DSH_ROOT = `${FORWARD_ACCEPTANCE_ROOT}/dsh-runtime`;

const PINNED_DSH_CONTENT_SHA256 =
  "69bf698a112fe3ca1da8449818282116d5d92fb3760761ab05d638a0a68dbd59";
const PINNED_DSH_CLOSURE_SHA256 =
  "444ba58e0901635875e5fefc306097969b3a7828785355362bb39e8c79cd1b6b";

interface DirectoryIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

interface FixtureFileIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly sha256: string;
}

export interface VerifiedFixture {
  readonly workspace: DirectoryIdentity;
  readonly manifest: ForwardFixtureManifest;
  readonly manifestIdentity: FixtureFileIdentity;
  readonly labels: ForwardIndependentLabelManifest;
  readonly labelsIdentity: FixtureFileIdentity;
  readonly files: readonly FixtureFileIdentity[];
  readonly digest: string;
}

function strictChild(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function physicalDirectory(path: string, label: string): Promise<DirectoryIdentity> {
  const absolute = resolve(path);
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(absolute);
  } catch {
    throw new Error(`${label} must be a physical 0700 directory`);
  }
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    (entry.mode & 0o777) !== 0o700 ||
    (await realpath(absolute)) !== absolute
  ) {
    throw new Error(`${label} must be a physical 0700 directory`);
  }
  return { path: absolute, dev: entry.dev, ino: entry.ino };
}

async function assertDirectoryIdentity(identity: DirectoryIdentity, label: string): Promise<void> {
  const current = await physicalDirectory(identity.path, label);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new Error(`${label} identity changed`);
  }
}

async function physicalFile(path: string, label: string): Promise<FixtureFileIdentity> {
  const absolute = resolve(path);
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(absolute);
  } catch {
    throw new Error(`${label} must be a physical 0600 file`);
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    (before.mode & 0o777) !== 0o600 ||
    (await realpath(absolute)) !== absolute
  ) {
    throw new Error(`${label} must be a physical 0600 file with no hard links`);
  }
  const bytes = await readFile(absolute);
  const after = await lstat(absolute);
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw new Error(`${label} changed while it was read`);
  }
  return {
    path: absolute,
    dev: before.dev,
    ino: before.ino,
    size: before.size,
    sha256: sha256Hex(bytes),
  };
}

async function assertFileIdentity(identity: FixtureFileIdentity, label: string): Promise<void> {
  const current = await physicalFile(identity.path, label);
  if (
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    current.size !== identity.size ||
    current.sha256 !== identity.sha256
  ) {
    throw new Error(`${label} identity or bytes changed`);
  }
}

async function resolvePhysicalFixtureFile(workspace: string, ref: string): Promise<string> {
  const target = resolve(workspace, ref);
  if (!strictChild(workspace, target)) throw new Error("fixture ref escapes its workspace");
  let current = workspace;
  for (const segment of relative(workspace, target).split("/")) {
    current = resolve(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error("fixture ref crosses a symbolic link");
  }
  return target;
}

function assertFixtureRefSafe(ref: string): void {
  const segments = ref.split("/");
  if (
    segments.some(
      (segment) =>
        segment === ".git" ||
        segment === ".ssh" ||
        segment === ".codex" ||
        segment === ".dsh" ||
        segment === "node_modules" ||
        segment === ".env" ||
        segment.startsWith(".env.") ||
        segment === ".openai-codex-auth.json" ||
        isCredentialPathSegment(segment),
    )
  ) {
    throw new Error(`synthetic fixture path is credential-sensitive: ${ref}`);
  }
}

async function assertFixtureTreeClosed(
  workspace: string,
  manifest: ForwardFixtureManifest,
): Promise<void> {
  const expectedFiles = new Set(manifest.files.map((entry) => entry.ref));
  const expectedDirectories = new Set<string>();
  for (const ref of expectedFiles) {
    const segments = ref.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  const actualFiles = new Set<string>();
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const ref = prefix === "" ? name : `${prefix}/${name}`;
      if (ref === FORWARD_FIXTURE_MANIFEST) continue;
      const path = `${directory}/${name}`;
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new Error(`synthetic fixture crosses a symlink: ${ref}`);
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(ref)) {
          throw new Error(`synthetic fixture workspace contains an undeclared entry: ${ref}`);
        }
        await physicalDirectory(path, `synthetic fixture directory ${ref}`);
        await walk(path, ref);
        continue;
      }
      if (!entry.isFile() || !expectedFiles.has(ref)) {
        throw new Error(`synthetic fixture workspace contains an undeclared entry: ${ref}`);
      }
      actualFiles.add(ref);
    }
  }
  await walk(workspace, "");
  if (
    actualFiles.size !== expectedFiles.size ||
    [...expectedFiles].some((ref) => !actualFiles.has(ref))
  ) {
    throw new Error("synthetic fixture manifest does not close over its workspace inputs");
  }
}

export async function verifyForwardFixture(workspaceInput: string): Promise<VerifiedFixture> {
  const managedRoot = await physicalDirectory(
    FORWARD_FIXTURES_ROOT,
    "managed synthetic fixture root",
  );
  const workspace = await physicalDirectory(workspaceInput, "synthetic fixture workspace");
  if (!strictChild(managedRoot.path, workspace.path)) {
    throw new Error("workspace must be under the managed synthetic fixture workspace root");
  }
  const manifestPath = `${workspace.path}/${FORWARD_FIXTURE_MANIFEST}`;
  const manifestIdentity = await physicalFile(manifestPath, "synthetic fixture manifest");
  const manifestSource = await readFile(manifestPath, "utf8");
  const manifest = forwardFixtureManifestSchema.parse(JSON.parse(manifestSource));
  if (manifestSource !== `${canonicalJson(manifest)}\n`) {
    throw new Error("synthetic fixture manifest must use canonical JSON bytes");
  }
  await assertFileIdentity(manifestIdentity, "synthetic fixture manifest");
  await assertFixtureTreeClosed(workspace.path, manifest);
  const labelsRoot = await physicalDirectory(FORWARD_LABELS_ROOT, "independent label root");
  const labelsPath = `${labelsRoot.path}/${manifest.fixture_set_id}.json`;
  const labelsIdentity = await physicalFile(labelsPath, "independent label manifest");
  const labelsSource = await readFile(labelsPath, "utf8");
  const labels = forwardIndependentLabelManifestSchema.parse(JSON.parse(labelsSource));
  if (labelsSource !== `${canonicalJson(labels)}\n`) {
    throw new Error("independent label manifest must use canonical JSON bytes");
  }
  const manifestDigest = canonicalJsonDigest(manifest);
  if (
    labels.fixture_set_id !== manifest.fixture_set_id ||
    labels.fixture_manifest_sha256 !== manifestDigest
  ) {
    throw new Error("independent labels do not bind the exact synthetic fixture manifest");
  }
  await assertFileIdentity(labelsIdentity, "independent label manifest");
  const files: FixtureFileIdentity[] = [];
  for (const item of manifest.files) {
    if (item.ref === FORWARD_FIXTURE_MANIFEST || item.ref.startsWith("domain-eval/")) {
      throw new Error("fixture manifest may bind only immutable synthetic input files");
    }
    assertFixtureRefSafe(item.ref);
    const identity = await physicalFile(
      await resolvePhysicalFixtureFile(workspace.path, item.ref),
      `synthetic fixture ${item.ref}`,
    );
    if (identity.sha256 !== item.sha256)
      throw new Error(`synthetic fixture digest mismatch: ${item.ref}`);
    if (identity.size > 1024 * 1024) throw new Error(`synthetic fixture is too large: ${item.ref}`);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(identity.path));
    } catch {
      throw new Error(`synthetic fixture must be UTF-8 text: ${item.ref}`);
    }
    assertSecretFreeText(text);
    await assertFileIdentity(identity, `synthetic fixture ${item.ref}`);
    files.push(identity);
  }
  try {
    await lstat(`${workspace.path}/domain-eval`);
    throw new Error("synthetic fixture workspace must be fresh before an author forward run");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    workspace,
    manifest,
    manifestIdentity,
    labels,
    labelsIdentity,
    files,
    digest: canonicalJsonDigest({
      fixture_manifest_sha256: manifestDigest,
      independent_labels_sha256: canonicalJsonDigest(labels),
    }),
  };
}

export interface ReviewedPackage {
  readonly bytes: Buffer;
  readonly contentSha256: string;
  readonly packageVersion: string;
}

function tarString(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function tarOctal(header: Buffer, start: number, length: number): number {
  const value = tarString(header, start, length).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("reviewed package tar has an invalid octal field");
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("reviewed package tar has an invalid numeric field");
  }
  return parsed;
}

export function fingerprintPackageTarContent(bytes: Buffer): Omit<ReviewedPackage, "bytes"> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PACKAGE_TAR_BYTES) {
    throw new Error("reviewed package tar size is invalid");
  }
  let tar: Buffer;
  try {
    tar = gunzipSync(bytes);
  } catch {
    throw new Error("reviewed package must be a gzip-compressed tar archive");
  }
  if (tar.byteLength < 1_536 || tar.byteLength % 512 !== 0) {
    throw new Error("reviewed package tar structure is invalid");
  }
  const files: Array<{
    readonly path: string;
    readonly executable: boolean;
    readonly sha256: string;
  }> = [];
  const seen = new Set<string>();
  let packageManifest: { readonly name?: unknown; readonly version?: unknown } | undefined;
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks >= 2) {
        if (!tar.subarray(offset).every((byte) => byte === 0)) {
          throw new Error("reviewed package tar has non-zero bytes after its terminator");
        }
        break;
      }
      continue;
    }
    if (zeroBlocks !== 0 || header.subarray(257, 262).toString("ascii") !== "ustar") {
      throw new Error("reviewed package tar structure is invalid");
    }
    const storedChecksum = tarOctal(header, 148, 8);
    let checksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      checksum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
    }
    if (checksum !== storedChecksum) throw new Error("reviewed package tar checksum is invalid");
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fullPath = prefix.length === 0 ? name : `${prefix}/${name}`;
    const type = String.fromCharCode(header[156] ?? 0);
    const size = tarOctal(header, 124, 12);
    const mode = tarOctal(header, 100, 8);
    if (
      !fullPath.startsWith("package/") ||
      fullPath.includes("\\") ||
      fullPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("reviewed package tar contains an unsafe path");
    }
    const relativePath = fullPath.slice("package/".length).replace(/\/$/, "");
    if (relativePath.length === 0) throw new Error("reviewed package tar entry is invalid");
    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + paddedSize > tar.byteLength) {
      throw new Error("reviewed package tar entry exceeds the archive boundary");
    }
    if (type === "5") {
      if (size !== 0) throw new Error("reviewed package tar directory has content bytes");
      continue;
    }
    if (type !== "0" && type !== "\0") {
      throw new Error("reviewed package tar contains a non-regular entry");
    }
    if (seen.has(relativePath)) throw new Error("reviewed package tar contains a duplicate path");
    seen.add(relativePath);
    const content = tar.subarray(offset, offset + size);
    files.push({
      path: relativePath,
      executable: (mode & 0o111) !== 0,
      sha256: sha256Hex(content),
    });
    if (relativePath === "package.json") {
      try {
        packageManifest = JSON.parse(content.toString("utf8")) as {
          readonly name?: unknown;
          readonly version?: unknown;
        };
      } catch {
        throw new Error("reviewed package package.json is invalid");
      }
    }
    offset += paddedSize;
  }
  if (zeroBlocks < 2 || packageManifest?.name !== "dsh-eval-lab") {
    throw new Error("reviewed package is not a complete dsh-eval-lab tarball");
  }
  if (typeof packageManifest.version !== "string" || packageManifest.version.length === 0) {
    throw new Error("reviewed package version is invalid");
  }
  return {
    contentSha256: fingerprintPackageEntries(files),
    packageVersion: packageManifest.version,
  };
}

export async function readForwardReviewedPackage(
  pathInput: string,
  sourceRevision: string,
): Promise<ReviewedPackage> {
  const packageRoot = await physicalDirectory(
    FORWARD_PACKAGES_ROOT,
    "managed reviewed package root",
  );
  const revisionRoot = await physicalDirectory(
    `${packageRoot.path}/${sourceRevision}`,
    "reviewed package revision root",
  );
  const path = resolve(pathInput);
  if (dirname(path) !== revisionRoot.path || !strictChild(packageRoot.path, path)) {
    throw new Error("package must be under the managed reviewed package root");
  }
  const identity = await physicalFile(path, "reviewed package tar");
  const bytes = await readFile(identity.path);
  const content = fingerprintPackageTarContent(bytes);
  if (basename(identity.path) !== `${sha256Hex(bytes)}.tgz`) {
    throw new Error("reviewed package filename must bind its exact SHA-256");
  }
  await assertFileIdentity(identity, "reviewed package tar");
  return { bytes, ...content };
}

async function readProjectedCard(
  workspace: string,
  ref: string,
): Promise<
  | {
      readonly status: ForwardRunProjection["cases"][number]["observed_status"];
      readonly sha256: string;
    }
  | undefined
> {
  let path: string;
  try {
    path = await resolvePhysicalFixtureFile(workspace, `domain-eval/${ref}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const identity = await physicalFile(path, `forward artifact ${ref}`);
  const source = await readFile(identity.path, "utf8");
  const card = parseDomainEvidenceCard(JSON.parse(source));
  if (source !== `${canonicalJson(card)}\n`) {
    throw new Error(`forward artifact is not canonical: ${ref}`);
  }
  await assertFileIdentity(identity, `forward artifact ${ref}`);
  return { status: card.status, sha256: canonicalJsonDigest(card) };
}

async function readCandidateSnapshots(
  workspace: string,
): Promise<readonly { readonly ref: string; readonly sha256: string }[]> {
  const root = `${workspace}/domain-eval/candidates`;
  try {
    await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const identity = await physicalDirectory(root, "forward candidate namespace");
  const snapshots: Array<{ readonly ref: string; readonly sha256: string }> = [];
  for (const name of (await readdir(identity.path)).sort()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(name)) {
      throw new Error("forward candidate namespace contains an unknown entry");
    }
    const ref = `candidates/${name}`;
    const file = await physicalFile(`${identity.path}/${name}`, `forward candidate ${ref}`);
    const source = await readFile(file.path, "utf8");
    const value = JSON.parse(source) as unknown;
    if (source !== `${canonicalJson(value)}\n`) {
      throw new Error(`forward candidate is not canonical: ${ref}`);
    }
    await assertFileIdentity(file, `forward candidate ${ref}`);
    snapshots.push({ ref, sha256: canonicalJsonDigest(value) });
  }
  await assertDirectoryIdentity(identity, "forward candidate namespace");
  return snapshots;
}

export async function captureForwardProjection(input: {
  readonly fixture: VerifiedFixture;
  readonly handle: ForwardRunHandle;
  readonly evidenceRoot: string;
}): Promise<ForwardRunProjection> {
  await assertDirectoryIdentity(input.fixture.workspace, "synthetic fixture workspace");
  await assertFileIdentity(input.fixture.manifestIdentity, "synthetic fixture manifest");
  await assertFileIdentity(input.fixture.labelsIdentity, "independent label manifest");
  for (const file of input.fixture.files) await assertFileIdentity(file, "synthetic fixture input");
  const evidence = await readForwardEvidenceRoot(input.evidenceRoot, { allowIncomplete: true });
  const run = evidence.runs.find(
    (entry) => entry.descriptor.run_id === input.handle.descriptor.run_id,
  );
  if (
    run === undefined ||
    canonicalJson(run.descriptor) !== canonicalJson(input.handle.descriptor)
  ) {
    throw new Error("forward run is missing from its runtime-owned evidence root");
  }
  const candidateSnapshots = await readCandidateSnapshots(input.fixture.workspace.path);
  const cases: ForwardRunProjection["cases"][number][] = [];
  for (const label of input.fixture.labels.labels) {
    const target = await readProjectedCard(input.fixture.workspace.path, label.target_ref);
    const attemptCandidateRefs = new Set(
      run.attempts
        .filter((attempt) => attempt.intent.target_ref === label.target_ref)
        .flatMap((attempt) =>
          attempt.intent.candidate_ref === undefined ? [] : [attempt.intent.candidate_ref],
        ),
    );
    const candidateArtifacts =
      target === undefined
        ? candidateSnapshots.filter((candidate) => attemptCandidateRefs.has(candidate.ref))
        : candidateSnapshots.filter((candidate) => candidate.sha256 === target.sha256);
    if (
      target !== undefined &&
      candidateSnapshots.some(
        (candidate) =>
          attemptCandidateRefs.has(candidate.ref) && candidate.sha256 !== target.sha256,
      )
    ) {
      throw new Error("forward candidate bytes do not match their attempted target");
    }
    cases.push({
      case_id: label.case_id,
      target_ref: label.target_ref,
      expected_status: label.expected_status,
      ...(target === undefined
        ? {}
        : { observed_status: target.status, target_sha256: target.sha256 }),
      candidate_artifacts: candidateArtifacts,
    });
  }
  await assertDirectoryIdentity(input.fixture.workspace, "synthetic fixture workspace");
  await assertFileIdentity(input.fixture.manifestIdentity, "synthetic fixture manifest");
  await assertFileIdentity(input.fixture.labelsIdentity, "independent label manifest");
  for (const file of input.fixture.files) await assertFileIdentity(file, "synthetic fixture input");
  return {
    schema_version: 1,
    run_id: input.handle.descriptor.run_id,
    descriptor_sha256: canonicalJsonDigest(input.handle.descriptor),
    fixture_set_sha256: input.fixture.digest,
    cases,
  };
}

export function incompleteForwardProjection(
  fixture: VerifiedFixture,
  handle: ForwardRunHandle,
): ForwardRunProjection {
  return {
    schema_version: 1,
    run_id: handle.descriptor.run_id,
    descriptor_sha256: canonicalJsonDigest(handle.descriptor),
    fixture_set_sha256: fixture.digest,
    cases: fixture.labels.labels.map((label) => ({
      case_id: label.case_id,
      target_ref: label.target_ref,
      expected_status: label.expected_status,
      candidate_artifacts: [],
    })),
  };
}

export interface InternalAuthorForwardInput {
  readonly workspace: string;
  readonly task: string;
  readonly timeoutMs: number;
  readonly postOutputExitGraceMs?: number;
  readonly evidenceRoot: string;
  readonly runId: string;
  readonly sourceRevision: string;
  readonly packageTarPath: string;
}

export interface AuthorForwardOutput {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly receipt: ForwardRunReceipt;
}

class ProductionAuthorForwardRunner {
  async run(input: InternalAuthorForwardInput): Promise<AuthorForwardOutput> {
    const postOutputExitGraceMs = input.postOutputExitGraceMs ?? FORWARD_POST_OUTPUT_EXIT_GRACE_MS;
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new RangeError("author forward timeout must be positive and finite");
    }
    if (!Number.isFinite(postOutputExitGraceMs) || postOutputExitGraceMs <= 0) {
      throw new RangeError("post-output exit grace must be positive and finite");
    }
    if (!/^[a-f0-9]{40}$/.test(input.sourceRevision)) {
      throw new TypeError("author forward source revision must be an exact Git SHA");
    }
    const fixture = await verifyForwardFixture(input.workspace);
    const reviewedPackage = await readForwardReviewedPackage(
      input.packageTarPath,
      input.sourceRevision,
    );
    const runtime = await verifyAuthorForwardProductionRuntime(
      {
        packageTarPath: input.packageTarPath,
        packageContentSha256: reviewedPackage.contentSha256,
        packageVersion: reviewedPackage.packageVersion,
      },
      {
        dshHome: DEDICATED_DSH_HOME,
        authorProfileRoot: `${DEDICATED_DSH_HOME}/profiles/${PHASE3A_AUTHOR.profile}`,
        dshRuntimeRoot: FORWARD_DSH_ROOT,
        nodeExecutable: process.execPath,
        nodeVersion: process.version,
        expectedDshContentSha256: PINNED_DSH_CONTENT_SHA256,
        expectedDshClosureSha256: PINNED_DSH_CLOSURE_SHA256,
      },
    );
    const store = new ForwardEvidenceStore(input.evidenceRoot);
    const handle = await store.beginRun({
      runId: input.runId,
      sourceRevision: input.sourceRevision,
      packageTar: {
        sha256: sha256Hex(reviewedPackage.bytes),
        size: reviewedPackage.bytes.byteLength,
      },
      profile: PHASE3A_AUTHOR.profile,
      provider: FORWARD_MODEL_ROUTE.provider,
      model: FORWARD_MODEL_ROUTE.model,
      effort: FORWARD_MODEL_ROUTE.effort,
      promptSha256: sha256Hex(input.task),
      fixtureSetSha256: fixture.digest,
      dshLauncher: runtime.descriptor,
      startedAt: new Date().toISOString(),
    });
    const child = await runtime.launch({
      argv: ["--profile", PHASE3A_AUTHOR.profile, input.task],
      cwd: fixture.workspace.path,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        DSH_HOME: DEDICATED_DSH_HOME,
        DSH_EVAL_INSTANCE_ID: PHASE2_INSTANCE.id,
        DSH_TOOLS_MODE: "native",
        DSH_PERMISSION_MODE: "workspace-write",
        [FORWARD_RUN_ROOT_ENV]: handle.runRoot,
        [FORWARD_RUN_NONCE_ENV]: handle.nonce,
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let spawnError = false;
    let killTimer: NodeJS.Timeout | undefined;
    let postOutputExitTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref();
    };
    const armPostOutputExit = () => {
      if (postOutputExitTimer !== undefined) clearTimeout(postOutputExitTimer);
      postOutputExitTimer = setTimeout(terminate, postOutputExitGraceMs);
      postOutputExitTimer.unref();
    };
    const capture = (target: Buffer[], onData?: () => void) => (chunk: Buffer) => {
      const remaining = Math.max(0, FORWARD_MAX_OUTPUT_BYTES - outputBytes);
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining);
        target.push(Buffer.from(retained));
        outputBytes += retained.byteLength;
      }
      if (chunk.byteLength > remaining && !outputLimitExceeded) {
        outputLimitExceeded = true;
        terminate();
      }
      if (!outputLimitExceeded) onData?.();
    };
    child.stdout.on("data", capture(stdout, armPostOutputExit));
    child.stderr.on("data", capture(stderr));
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    timeout.unref();
    const terminal = await new Promise<{ exitCode: number | null; signal: string | null }>(
      (resolveTerminal) => {
        child.once("error", () => {
          spawnError = true;
        });
        child.once("close", (exitCode, signal) => {
          resolveTerminal({ exitCode, signal });
        });
      },
    );
    clearTimeout(timeout);
    if (killTimer !== undefined) clearTimeout(killTimer);
    if (postOutputExitTimer !== undefined) clearTimeout(postOutputExitTimer);
    let runtimeIdentityChanged = false;
    try {
      await runtime.assertUnchanged();
    } catch {
      runtimeIdentityChanged = true;
    }
    const stdoutText = Buffer.concat(stdout).toString("utf8");
    const stderrText = Buffer.concat(stderr).toString("utf8");
    const combined = `${stdoutText}\n${stderrText}`;
    const errorMarkers: string[] = FORWARD_ERROR_MARKERS.filter((marker) =>
      combined.includes(marker),
    );
    if (spawnError) errorMarkers.push("SPAWN_ERROR");
    if (runtimeIdentityChanged) errorMarkers.push("RUNTIME_IDENTITY_CHANGED");
    let projection: ForwardRunProjection;
    try {
      projection = await captureForwardProjection({
        fixture,
        handle,
        evidenceRoot: input.evidenceRoot,
      });
    } catch {
      errorMarkers.push("PROJECTION_ERROR");
      projection = incompleteForwardProjection(fixture, handle);
    }
    const receipt = await store.completeRun(handle, {
      endedAt: new Date().toISOString(),
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      timedOut,
      outputLimitExceeded,
      finalOutputSeen: stdoutText.trim().length > 0,
      errorMarkers,
      stdoutSha256: sha256Hex(stdoutText),
      stderrSha256: sha256Hex(stderrText),
      projection,
    });
    return {
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      stdout: stdoutText,
      stderr: stderrText,
      timedOut,
      outputLimitExceeded,
      receipt,
    };
  }
}

export function createProductionAuthorForwardRunner(): {
  readonly run: (input: InternalAuthorForwardInput) => Promise<AuthorForwardOutput>;
} {
  const runner = new ProductionAuthorForwardRunner();
  return { run: (input) => runner.run(input) };
}
