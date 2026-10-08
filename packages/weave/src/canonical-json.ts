import { createHash } from "node:crypto";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export class CanonicalJsonError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function serialize(value: unknown, location: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`non-finite number at ${location}`);
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        const ownKeys = Object.keys(value);
        const expectedKeys = Array.from({ length: value.length }, (_, index) => String(index));
        if (
          ownKeys.length !== value.length ||
          expectedKeys.some((key, index) => ownKeys[index] !== key)
        ) {
          throw new CanonicalJsonError(`sparse or extended array at ${location}`);
        }
        return `[${value.map((item, index) => serialize(item, `${location}[${index}]`)).join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalJsonError(`non-plain object at ${location}`);
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new CanonicalJsonError(`symbol-keyed property at ${location}`);
      }

      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
          throw new CanonicalJsonError(`accessor property at ${location}.${key}`);
        }
      }
      return `{${keys
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(record[key], `${location}.${key}`)}`)
        .join(",")}}`;
    }
    default:
      throw new CanonicalJsonError(`unsupported ${typeof value} at ${location}`);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, "$");
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJsonDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
