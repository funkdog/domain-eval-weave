import type { MeasurementValidity } from "../contracts/parsers.js";

export function assessMeasurementValidity(input: {
  readonly invalidators: readonly string[];
  readonly insufficient: readonly string[];
}): MeasurementValidity {
  const invalid = input.invalidators.length > 0;
  const usageMissing = input.insufficient.includes("USAGE_MISSING");
  const otherInsufficient = input.insufficient.some((code) => code !== "USAGE_MISSING");
  return {
    overall: invalid ? "invalid" : input.insufficient.length > 0 ? "insufficient" : "valid",
    dimensions: {
      outcome: invalid ? "invalid" : otherInsufficient ? "insufficient" : "valid",
      mechanism: invalid ? "invalid" : "valid",
      cost: invalid ? "invalid" : usageMissing ? "insufficient" : "valid",
    },
    reasons: [
      ...input.invalidators.map((code) => ({
        code,
        severity: "error" as const,
        message: "A hard measurement invalidator was detected.",
        evidence_refs: [],
      })),
      ...input.insufficient.map((code) => ({
        code,
        severity: "warning" as const,
        message: "Required evidence was insufficient.",
        evidence_refs: [],
      })),
    ],
  };
}
