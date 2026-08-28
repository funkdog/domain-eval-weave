import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { PHASE2_INSTANCE } from "../instance.js";
import {
  type OwnerConfirmationEvent,
  type OwnerConfirmationPointer,
  ownerConfirmationPointerSchema,
  parseOwnerConfirmationEvent,
} from "./contracts.js";

export class ConfirmationLedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConfirmationLedgerError";
    this.code = code;
  }
}

export const DEFAULT_CONFIRMATION_LEDGER_ROOT =
  `${PHASE2_INSTANCE.instanceRoot}/domain-confirmations` as const;

async function assertPhysicalDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    (entry.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== resolve(path)
  ) {
    throw new ConfirmationLedgerError(
      "CONFIRMATION_LEDGER_PATH_INVALID",
      "confirmation ledger must be a physical 0700 directory",
    );
  }
}

export class OwnerConfirmationLedger {
  readonly #root: string;

  constructor(root: string = DEFAULT_CONFIRMATION_LEDGER_ROOT) {
    this.#root = resolve(root);
  }

  async #ensureWriteRoot(): Promise<void> {
    try {
      await mkdir(this.#root, { recursive: true, mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertPhysicalDirectory(this.#root);
  }

  #path(confirmationId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(confirmationId)) {
      throw new ConfirmationLedgerError("CONFIRMATION_ID_INVALID", "confirmation id is invalid");
    }
    return `${this.#root}/${confirmationId}.json`;
  }

  async write(value: unknown): Promise<OwnerConfirmationPointer> {
    const event = parseOwnerConfirmationEvent(value);
    await this.#ensureWriteRoot();
    const path = this.#path(event.confirmation_id);
    const bytes = `${canonicalJson(event)}\n`;
    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(path, "utf8");
      if (existing !== bytes) {
        throw new ConfirmationLedgerError(
          "CONFIRMATION_CONFLICT",
          "confirmation id already binds different immutable bytes",
        );
      }
    }
    return ownerConfirmationPointerSchema.parse({
      confirmation_id: event.confirmation_id,
      sha256: canonicalJsonDigest(event),
    });
  }

  async read(pointerValue: unknown): Promise<OwnerConfirmationEvent> {
    const pointer = ownerConfirmationPointerSchema.parse(pointerValue);
    await assertPhysicalDirectory(this.#root);
    const path = this.#path(pointer.confirmation_id);
    const entry = await lstat(path);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      entry.nlink !== 1 ||
      (entry.mode & 0o777) !== 0o600 ||
      (await realpath(path)) !== path
    ) {
      throw new ConfirmationLedgerError(
        "CONFIRMATION_LEDGER_ENTRY_INVALID",
        "confirmation ledger entry must be a single-link physical 0600 regular file",
      );
    }
    const source = await readFile(path, "utf8");
    let event: OwnerConfirmationEvent;
    try {
      event = parseOwnerConfirmationEvent(JSON.parse(source));
    } catch {
      throw new ConfirmationLedgerError(
        "CONFIRMATION_LEDGER_ENTRY_INVALID",
        "confirmation ledger entry is invalid",
      );
    }
    if (
      source !== `${canonicalJson(event)}\n` ||
      event.confirmation_id !== pointer.confirmation_id ||
      canonicalJsonDigest(event) !== pointer.sha256
    ) {
      throw new ConfirmationLedgerError(
        "CONFIRMATION_LEDGER_ENTRY_INVALID",
        "confirmation ledger entry digest or canonical bytes drifted",
      );
    }
    return event;
  }
}
