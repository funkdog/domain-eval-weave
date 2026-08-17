import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import * as addFormatsModule from "ajv-formats";

import {
  parseActivationArtifact,
  parseEvalPack,
  parseExposureRecord,
  parseHarnessManifest,
  parseRegistry,
  parseSuiteManifest,
  parseTaskEntry,
} from "../../src/contracts/phase2.js";
import {
  validActivationArtifact,
  validEvalPack,
  validExposureRecord,
  validHarnessManifest,
  validRegistry,
  validSuiteManifest,
  validTaskEntry,
} from "../helpers/phase2-fixtures.js";

const CONTRACT_ROOT = new URL("../../contracts/", import.meta.url);
const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as FormatsPlugin;

async function validator(name: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(await readFile(new URL(name, CONTRACT_ROOT), "utf8")));
}

test("Phase 2 persisted faces have JSON Schema and Zod parser parity", async () => {
  const faces = [
    ["harness.schema.json", validHarnessManifest, parseHarnessManifest],
    ["registry.schema.json", validRegistry, parseRegistry],
    ["eval-pack.schema.json", validEvalPack, parseEvalPack],
    ["task-entry.schema.json", validTaskEntry, parseTaskEntry],
    ["activation.schema.json", validActivationArtifact, parseActivationArtifact],
    ["exposure.schema.json", validExposureRecord, parseExposureRecord],
    ["suite-manifest.schema.json", validSuiteManifest, parseSuiteManifest],
  ] as const;
  for (const [schemaName, value, parser] of faces) {
    const validate = await validator(schemaName);
    assert.equal(validate(value), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(parser(value), value);
  }
});

test("registry/eval pack rejects a missing bucket and duplicate task membership", () => {
  const missingBucket = structuredClone(validEvalPack) as Record<string, unknown>;
  const buckets = (missingBucket.buckets ?? {}) as Record<string, unknown>;
  buckets.holdout = [];
  assert.throws(() => parseEvalPack(missingBucket));

  const duplicate = structuredClone(validEvalPack) as Record<string, unknown>;
  const duplicateBuckets = duplicate.buckets as Record<string, string[]>;
  duplicateBuckets.holdout = ["ledger-full-v1"];
  assert.throws(() => parseEvalPack(duplicate));
});

test("activation rejects unknown operations and inconsistent summaries", () => {
  const unknown = structuredClone(validActivationArtifact) as Record<string, unknown>;
  ((unknown.events as Record<string, unknown>[])[0] ?? {}).operation = "future-operation";
  assert.throws(() => parseActivationArtifact(unknown));

  const inconsistent = structuredClone(validActivationArtifact) as Record<string, unknown>;
  (inconsistent.summary as Record<string, unknown>).activated = false;
  assert.throws(() => parseActivationArtifact(inconsistent));
});

test("Phase 2 refs reject absolute, traversal, backslash, and empty segments", () => {
  for (const ref of ["/tmp/task.md", "../task.md", "task\\task.md", "task//task.md"]) {
    const task = structuredClone(validTaskEntry) as Record<string, unknown>;
    task.public_task_ref = ref;
    assert.throws(() => parseTaskEntry(task));
  }
});

test("exposure rejects reversed timestamps and Suite rejects duplicate task ids", () => {
  const exposure = structuredClone(validExposureRecord) as Record<string, unknown>;
  exposure.ended_at = "2026-08-17T23:59:00.000Z";
  assert.throws(() => parseExposureRecord(exposure));

  const suite = structuredClone(validSuiteManifest) as Record<string, unknown>;
  const tasks = suite.tasks as Record<string, unknown>[];
  if (tasks[1] !== undefined) tasks[1].task_id = "ledger-audit-v1";
  assert.throws(() => parseSuiteManifest(suite));
});
