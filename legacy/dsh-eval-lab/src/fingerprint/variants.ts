import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";

const GOAL_ROWS = ["goal", "goal-round-driver", "command-goal", "tool-goal"] as const;

export interface ComposedRow {
  readonly id: string;
  readonly disabled?: boolean;
  readonly [key: string]: unknown;
}

export class VariantCompositionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VariantCompositionError";
    this.code = code;
  }
}

function indexedRows(rows: readonly ComposedRow[]): Map<string, ComposedRow> {
  const result = new Map<string, ComposedRow>();
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.length === 0 || result.has(row.id)) {
      throw new VariantCompositionError("COMPOSED_ROWS_INVALID", "composed row ids must be unique");
    }
    result.set(row.id, row);
  }
  return result;
}

function withoutDisabled(row: ComposedRow): Record<string, unknown> {
  const { disabled: _disabled, ...rest } = row;
  return rest;
}

export function fingerprintComposedRows(rows: readonly ComposedRow[]): string {
  const ordered = [...indexedRows(rows).values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return sha256Hex(canonicalJson(ordered));
}

export function assertExactGoalIntervention(
  controlRows: readonly ComposedRow[],
  treatmentRows: readonly ComposedRow[],
): { readonly differences: readonly string[] } {
  const control = indexedRows(controlRows);
  const treatment = indexedRows(treatmentRows);
  if (control.size !== treatment.size || [...control.keys()].some((id) => !treatment.has(id))) {
    throw new VariantCompositionError(
      "VARIANT_UNDECLARED_DIFF",
      "control and treatment contain different row ids",
    );
  }

  const differences: string[] = [];
  for (const [id, controlRow] of control) {
    const treatmentRow = treatment.get(id);
    if (treatmentRow === undefined) continue;
    if ((GOAL_ROWS as readonly string[]).includes(id)) {
      if (
        controlRow.disabled !== true ||
        treatmentRow.disabled !== false ||
        canonicalJson(withoutDisabled(controlRow)) !== canonicalJson(withoutDisabled(treatmentRow))
      ) {
        throw new VariantCompositionError(
          "VARIANT_UNDECLARED_DIFF",
          `Goal row ${id} does not differ only by the frozen disabled flag`,
        );
      }
      differences.push(`${id}.disabled`);
    } else if (canonicalJson(controlRow) !== canonicalJson(treatmentRow)) {
      throw new VariantCompositionError(
        "VARIANT_UNDECLARED_DIFF",
        `undeclared variant difference at row ${id}`,
      );
    }
  }
  if (differences.length !== GOAL_ROWS.length) {
    throw new VariantCompositionError(
      "VARIANT_UNDECLARED_DIFF",
      "all four frozen Goal rows must be present",
    );
  }
  return { differences };
}
