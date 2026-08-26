import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

const expected = [
  "calibration-case.schema.json",
  "capsule-manifest.schema.json",
  "domain-contract.schema.json",
  "evaluation-run.schema.json",
  "evaluator-package.schema.json",
  "requirement-delta.schema.json",
] as const;

test("Capsule generator exposes exactly six public JSON Schemas", async () => {
  const root = new URL("../../contracts/capsule/", import.meta.url);
  assert.deepEqual((await readdir(root)).sort(), expected);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const name of expected) {
    const schema = JSON.parse(await readFile(new URL(name, root), "utf8"));
    assert.doesNotThrow(() => ajv.compile(schema), name);
  }
});
