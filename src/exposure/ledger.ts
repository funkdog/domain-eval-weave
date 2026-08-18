import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";
import { type ExposureRecord, parseExposureRecord } from "../contracts/phase2.js";
import { DEDICATED_RUNTIME_ROOT } from "../runtime-root.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class ExposureLedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExposureLedgerError";
    this.code = code;
  }
}

export interface ExposureWrite {
  readonly path: string;
  readonly sha256: string;
}

export interface HoldoutIdentity {
  readonly task_id: string;
  readonly public_task_sha256: string;
  readonly effective_base_sha256: string;
}

interface HoldoutReservation extends HoldoutIdentity {
  readonly schema_version: 2;
  readonly suite_id: string;
}

function assertHoldoutIdentity(identity: HoldoutIdentity): void {
  if (
    !ID_PATTERN.test(identity.task_id) ||
    !SHA256_PATTERN.test(identity.public_task_sha256) ||
    !SHA256_PATTERN.test(identity.effective_base_sha256)
  ) {
    throw new ExposureLedgerError(
      "HOLDOUT_IDENTITY_INVALID",
      "holdout Task id and frozen evidence digests must be normalized",
    );
  }
}

function reservationPaths(root: string, identity: HoldoutIdentity): readonly string[] {
  return [
    resolve(root, `task--${identity.task_id}.json`),
    resolve(root, `public--${identity.public_task_sha256}.json`),
    resolve(root, `base--${identity.effective_base_sha256}.json`),
  ];
}

function isPathInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

export function phase2ExposureId(
  suiteId: string,
  taskId: string,
  arm: "control" | "treatment",
): string {
  if (!ID_PATTERN.test(suiteId) || !ID_PATTERN.test(taskId)) {
    throw new ExposureLedgerError("EXPOSURE_ID_INVALID", "Suite and Task ids must be normalized");
  }
  const id = `${suiteId}--${taskId}--${arm}`;
  if (!ID_PATTERN.test(id)) {
    throw new ExposureLedgerError("EXPOSURE_ID_INVALID", "derived exposure id is too long");
  }
  return id;
}

async function dedicatedRuntimeRoot(): Promise<string> {
  const root = resolve(DEDICATED_RUNTIME_ROOT);
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700) {
    throw new ExposureLedgerError(
      "RUNTIME_ROOT_INVALID",
      "dedicated runtime root must be a physical 0700 directory",
    );
  }
  return realpath(root);
}

async function ensurePrivateDirectory(
  target: string,
  finalCode: string,
  createMissing = true,
): Promise<string> {
  const realRuntime = await dedicatedRuntimeRoot();
  const runtime = resolve(DEDICATED_RUNTIME_ROOT);
  const normalizedTarget = resolve(target);
  if (!isPathInside(runtime, normalizedTarget)) {
    throw new ExposureLedgerError(
      "EXPOSURE_ROOT_ESCAPE",
      "exposure storage must remain under the dedicated runtime root",
    );
  }

  let current = runtime;
  for (const segment of relative(runtime, normalizedTarget).split("/")) {
    current = resolve(current, segment);
    let missing = false;
    try {
      await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing = true;
    }
    if (missing) {
      if (!createMissing) {
        throw new ExposureLedgerError(finalCode, "required exposure directory is missing");
      }
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }

    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700) {
      throw new ExposureLedgerError(finalCode, "exposure path must contain only 0700 directories");
    }
    const physical = await realpath(current);
    if (!isPathInside(realRuntime, physical)) {
      throw new ExposureLedgerError(finalCode, "exposure path resolves outside runtime root");
    }
  }
  return realpath(normalizedTarget);
}

async function readRecord(path: string, expectedId?: string): Promise<ExposureRecord> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new ExposureLedgerError(
      "EXPOSURE_ENTRY_INVALID",
      "exposure entry must be a physical 0600 file",
    );
  }
  const text = await readFile(path, "utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new ExposureLedgerError("EXPOSURE_JSON_INVALID", "exposure entry is not JSON");
  }
  const record = parseExposureRecord(decoded);
  if (canonicalJson(record) !== text) {
    throw new ExposureLedgerError("EXPOSURE_NOT_CANONICAL", "exposure entry is not canonical JSON");
  }
  if (expectedId !== undefined && record.exposure_id !== expectedId) {
    throw new ExposureLedgerError(
      "EXPOSURE_FILENAME_MISMATCH",
      "exposure filename and record id disagree",
    );
  }
  return record;
}

async function readReservation(path: string): Promise<HoldoutReservation> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new ExposureLedgerError(
      "HOLDOUT_RESERVATION_INVALID",
      "holdout reservation must be a physical 0600 file",
    );
  }
  const text = await readFile(path, "utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new ExposureLedgerError("HOLDOUT_RESERVATION_INVALID", "holdout reservation is not JSON");
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded) ||
    Object.keys(decoded).sort().join(",") !==
      "effective_base_sha256,public_task_sha256,schema_version,suite_id,task_id"
  ) {
    throw new ExposureLedgerError(
      "HOLDOUT_RESERVATION_INVALID",
      "holdout reservation has an unknown shape",
    );
  }
  const record = decoded as Record<string, unknown>;
  if (
    record.schema_version !== 2 ||
    typeof record.task_id !== "string" ||
    !ID_PATTERN.test(record.task_id) ||
    typeof record.public_task_sha256 !== "string" ||
    !SHA256_PATTERN.test(record.public_task_sha256) ||
    typeof record.effective_base_sha256 !== "string" ||
    !SHA256_PATTERN.test(record.effective_base_sha256) ||
    typeof record.suite_id !== "string" ||
    !ID_PATTERN.test(record.suite_id) ||
    canonicalJson(record) !== text
  ) {
    throw new ExposureLedgerError(
      "HOLDOUT_RESERVATION_INVALID",
      "holdout reservation is not canonical or normalized",
    );
  }
  return record as unknown as HoldoutReservation;
}

export class ExposureLedger {
  readonly #instanceRoot: string;

  constructor(instanceRoot: string) {
    if (!isAbsolute(instanceRoot)) {
      throw new ExposureLedgerError(
        "INSTANCE_ROOT_NOT_ABSOLUTE",
        "exposure instance root must be absolute",
      );
    }
    this.#instanceRoot = resolve(instanceRoot);
  }

  async #root(): Promise<string> {
    await ensurePrivateDirectory(this.#instanceRoot, "INSTANCE_ROOT_INVALID");
    return ensurePrivateDirectory(
      resolve(this.#instanceRoot, "exposures"),
      "EXPOSURE_ROOT_INVALID",
    );
  }

  async #readRoot(): Promise<string> {
    await ensurePrivateDirectory(this.#instanceRoot, "INSTANCE_ROOT_INVALID", false);
    return ensurePrivateDirectory(
      resolve(this.#instanceRoot, "exposures"),
      "EXPOSURE_ROOT_INVALID",
      false,
    );
  }

  async #reservationRoot(): Promise<string> {
    await ensurePrivateDirectory(this.#instanceRoot, "INSTANCE_ROOT_INVALID");
    return ensurePrivateDirectory(
      resolve(this.#instanceRoot, "holdout-reservations"),
      "HOLDOUT_RESERVATION_ROOT_INVALID",
    );
  }

  async #assertHoldoutReservation(record: ExposureRecord): Promise<void> {
    if (record.bucket !== "holdout") return;
    const root = await this.#reservationRoot();
    const identity = {
      task_id: record.task_id,
      public_task_sha256: record.public_task_sha256,
      effective_base_sha256: record.effective_base_sha256,
    };
    for (const path of reservationPaths(root, identity)) {
      let reservation: HoldoutReservation;
      try {
        reservation = await readReservation(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        throw new ExposureLedgerError(
          "HOLDOUT_RESERVATION_MISSING",
          "holdout exposure requires a complete atomic Suite reservation",
        );
      }
      if (
        reservation.task_id !== record.task_id ||
        reservation.public_task_sha256 !== record.public_task_sha256 ||
        reservation.effective_base_sha256 !== record.effective_base_sha256 ||
        reservation.suite_id !== record.suite_id
      ) {
        throw new ExposureLedgerError(
          "HOLDOUT_RESERVATION_MISMATCH",
          "holdout exposure is not owned by the reserving Suite and frozen evidence",
        );
      }
    }
  }

  async write(input: unknown): Promise<ExposureWrite> {
    const record = parseExposureRecord(input);
    const expectedId = phase2ExposureId(record.suite_id, record.task_id, record.arm);
    if (record.exposure_id !== expectedId) {
      throw new ExposureLedgerError(
        "EXPOSURE_ID_MISMATCH",
        "exposure id must be derived from Suite, Task, and arm",
      );
    }
    await this.#assertHoldoutReservation(record);
    const root = await this.#root();
    const path = resolve(root, `${record.exposure_id}.json`);
    if (!isPathInside(root, path)) {
      throw new ExposureLedgerError("EXPOSURE_PATH_ESCAPE", "exposure path escapes its root");
    }
    const bytes = Buffer.from(canonicalJson(record), "utf8");
    const temporary = resolve(root, `.${record.exposure_id}.tmp-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readRecord(path, record.exposure_id);
        if (canonicalJson(existing) !== bytes.toString("utf8")) {
          throw new ExposureLedgerError(
            "EXPOSURE_ALREADY_EXISTS",
            "exposure id is already frozen with different bytes",
          );
        }
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return { path, sha256: sha256Hex(bytes) };
  }

  async read(exposureId: string): Promise<ExposureWrite & { readonly record: ExposureRecord }> {
    if (!ID_PATTERN.test(exposureId)) {
      throw new ExposureLedgerError("EXPOSURE_ID_INVALID", "exposure id must be normalized");
    }
    const root = await this.#readRoot();
    const path = resolve(root, `${exposureId}.json`);
    if (!isPathInside(root, path)) {
      throw new ExposureLedgerError("EXPOSURE_PATH_ESCAPE", "exposure path escapes its root");
    }
    let record: ExposureRecord;
    try {
      record = await readRecord(path, exposureId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw new ExposureLedgerError("EXPOSURE_ENTRY_MISSING", "exposure entry is missing");
    }
    return { path, sha256: sha256Hex(canonicalJson(record)), record };
  }

  async list(): Promise<readonly ExposureRecord[]> {
    const root = await this.#root();
    const records: ExposureRecord[] = [];
    for (const name of (await readdir(root)).sort()) {
      if (!name.endsWith(".json")) {
        throw new ExposureLedgerError(
          "EXPOSURE_ENTRY_UNKNOWN",
          "exposure root contains an unknown entry",
        );
      }
      const id = name.slice(0, -".json".length);
      if (!ID_PATTERN.test(id)) {
        throw new ExposureLedgerError(
          "EXPOSURE_FILENAME_INVALID",
          "exposure filename is not normalized",
        );
      }
      records.push(await readRecord(resolve(root, name), id));
    }
    return records;
  }

  async assertHoldoutUnexposed(identity: HoldoutIdentity): Promise<void> {
    assertHoldoutIdentity(identity);
    if (
      (await this.list()).some(
        (record) =>
          record.task_id === identity.task_id ||
          record.public_task_sha256 === identity.public_task_sha256 ||
          record.effective_base_sha256 === identity.effective_base_sha256,
      )
    ) {
      throw new ExposureLedgerError(
        "HOLDOUT_ALREADY_EXPOSED",
        `holdout Task or its frozen evidence has an existing model exposure: ${identity.task_id}`,
      );
    }
  }

  async reserveHoldout(identity: HoldoutIdentity, suiteId: string): Promise<void> {
    assertHoldoutIdentity(identity);
    if (!ID_PATTERN.test(suiteId)) {
      throw new ExposureLedgerError("EXPOSURE_ID_INVALID", "holdout Suite id must be normalized");
    }
    await this.assertHoldoutUnexposed(identity);
    const root = await this.#reservationRoot();
    const reservation: HoldoutReservation = {
      schema_version: 2,
      ...identity,
      suite_id: suiteId,
    };
    const bytes = Buffer.from(canonicalJson(reservation), "utf8");
    const temporary = resolve(root, `.${identity.task_id}.tmp-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      for (const path of reservationPaths(root, identity)) {
        if (!isPathInside(root, path)) {
          throw new ExposureLedgerError(
            "HOLDOUT_RESERVATION_PATH_ESCAPE",
            "holdout reservation escapes its root",
          );
        }
        try {
          await link(temporary, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const existing = await readReservation(path);
          if (canonicalJson(existing) !== bytes.toString("utf8")) {
            throw new ExposureLedgerError(
              "HOLDOUT_ALREADY_RESERVED",
              `holdout Task or its frozen evidence is already reserved: ${identity.task_id}`,
            );
          }
        }
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
