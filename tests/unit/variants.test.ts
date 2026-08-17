import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

import {
  assertExactGoalIntervention,
  fingerprintComposedRows,
  VariantCompositionError,
} from "../../src/fingerprint/variants.js";

const sharedRows = [
  { id: "dsh-eval-app", disabled: true },
  { id: "dsh-eval-bridge", disabled: false },
  { id: "tool-fs", disabled: false, config: { mode: "workspace" } },
];

test("only the four frozen Goal disabled flags may differ", () => {
  const control = [
    ...sharedRows,
    { id: "goal", disabled: true },
    { id: "goal-round-driver", disabled: true },
    { id: "command-goal", disabled: true },
    { id: "tool-goal", disabled: true },
  ];
  const treatment = control.map((row) =>
    ["goal", "goal-round-driver", "command-goal", "tool-goal"].includes(row.id)
      ? { ...row, disabled: false }
      : row,
  );
  const result = assertExactGoalIntervention(control, treatment);
  assert.equal(result.differences.length, 4);
  assert.notEqual(fingerprintComposedRows(control), fingerprintComposedRows(treatment));

  assert.throws(
    () =>
      assertExactGoalIntervention(
        control,
        treatment.map((row) => (row.id === "tool-fs" ? { ...row, config: { mode: "host" } } : row)),
      ),
    (error: unknown) =>
      error instanceof VariantCompositionError && error.code === "VARIANT_UNDECLARED_DIFF",
  );
});

test("checked-in common/off/on patches declare the frozen role and Goal rows", async () => {
  const [common, off, on] = await Promise.all(
    ["common.patch.yml", "goal-off.patch.yml", "goal-on.patch.yml"].map(async (name) =>
      parse(await readFile(new URL(`../../variants/${name}`, import.meta.url), "utf8")),
    ),
  );
  assert.ok(Array.isArray(common));
  assert.deepEqual(off, [
    { id: "goal", disabled: true },
    { id: "goal-round-driver", disabled: true },
    { id: "command-goal", disabled: true },
    { id: "tool-goal", disabled: true },
  ]);
  assert.deepEqual(
    on,
    off.map((row) => ({ ...row, disabled: false })),
  );
});
