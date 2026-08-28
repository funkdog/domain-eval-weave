import { decodeStorageRecord as decodeOfficialStorageRecord } from "@deepseek-ai/dsh-session";

export interface SessionHeaderRecord {
  readonly type: "session";
  readonly version: number;
  readonly id: string;
  readonly cwd?: string;
  readonly createdAt: number;
  readonly delegationDepth?: number;
  readonly agentPreset?: string;
  readonly parentSession?: string;
}

export interface SessionEventRecord {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly ignorable?: boolean;
}

export type StorageRecordDecoder = (record: unknown) => readonly unknown[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHeader(value: unknown): SessionHeaderRecord {
  if (
    !isRecord(value) ||
    value.type !== "session" ||
    !Number.isSafeInteger(value.version) ||
    typeof value.id !== "string" ||
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    (value.delegationDepth !== undefined &&
      (!Number.isSafeInteger(value.delegationDepth) || (value.delegationDepth as number) < 0))
  ) {
    throw new Error("Session header is invalid");
  }
  return value as unknown as SessionHeaderRecord;
}

function parseEvent(value: unknown, expectedSeq: number): SessionEventRecord {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !value.type.includes("/") ||
    value.seq !== expectedSeq ||
    typeof value.time !== "number" ||
    !Number.isFinite(value.time) ||
    !("data" in value)
  ) {
    throw new Error("Session event is invalid or has a seq gap");
  }
  return value as unknown as SessionEventRecord;
}

export function decodeSessionJsonl(
  text: string,
  decodeStorageRecord: StorageRecordDecoder,
): { readonly header: SessionHeaderRecord; readonly events: readonly SessionEventRecord[] } {
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("Session log is empty");
  let headerValue: unknown;
  try {
    headerValue = JSON.parse(lines[0] ?? "");
  } catch {
    throw new Error("Session header is not JSON");
  }
  const header = parseHeader(headerValue);
  const events: SessionEventRecord[] = [];
  for (const line of lines.slice(1)) {
    let storageRecord: unknown;
    try {
      storageRecord = JSON.parse(line);
    } catch {
      throw new Error("Session storage row is not JSON");
    }
    if (
      isRecord(storageRecord) &&
      typeof storageRecord.type === "string" &&
      !storageRecord.type.includes("/")
    ) {
      throw new Error("packed Session rows are forbidden when packChunks=false");
    }
    for (const decoded of decodeStorageRecord(storageRecord)) {
      events.push(parseEvent(decoded, events.length));
    }
  }
  return { header, events };
}

export function decodeOfficialSessionJsonl(text: string): {
  readonly header: SessionHeaderRecord;
  readonly events: readonly SessionEventRecord[];
} {
  return decodeSessionJsonl(text, decodeOfficialStorageRecord);
}
