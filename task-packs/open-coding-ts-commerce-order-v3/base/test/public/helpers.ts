import type { OperationResult } from "../../src/types.ts";

export function accepted<T>(value: T | OperationResult<T>): T {
  if (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "accepted" || value.status === "rejected")
  ) {
    if (value.status === "rejected") throw new Error("operation was rejected");
    return value.value;
  }
  return value as T;
}
