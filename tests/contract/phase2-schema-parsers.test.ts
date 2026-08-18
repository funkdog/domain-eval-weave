import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import * as addFormatsModule from "ajv-formats";
import { parseQualificationEvidence } from "../../src/contracts/parsers.js";
import {
  assertActivationArtifactSemantics,
  assertSuiteManifestSemantics,
  parseActivationArtifact,
  parseCampaignPointerArtifact,
  parseEvalPack,
  parseExposureRecord,
  parseHarnessManifest,
  parseRegistry,
  parseRegistrySnapshot,
  parseSuiteEvaluationArtifact,
  parseSuiteInvalidEnvelope,
  parseSuiteManifest,
  parseSuiteReport,
  parseTaskEntry,
} from "../../src/contracts/phase2.js";
import { validQualificationEvidence } from "../helpers/fixtures.js";
import {
  validActivationArtifact,
  validCampaignPointerArtifact,
  validEvalPack,
  validExposureRecord,
  validHarnessManifest,
  validRegistry,
  validRegistrySnapshot,
  validSuiteEvaluation,
  validSuiteInvalidEnvelope,
  validSuiteManifest,
  validSuiteReport,
  validTaskEntry,
} from "../helpers/phase2-fixtures.js";

const CONTRACT_ROOT = new URL("../../contracts/", import.meta.url);
const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as FormatsPlugin;

async function validator(name: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  for (const schemaName of [
    "registry.schema.json",
    "eval-pack.schema.json",
    "task-entry.schema.json",
    "suite-evaluation.schema.json",
    name,
  ]) {
    const schema = JSON.parse(await readFile(new URL(schemaName, CONTRACT_ROOT), "utf8"));
    if (!ajv.getSchema(schema.$id)) ajv.addSchema(schema);
  }
  const validate = ajv.getSchema(`https://dsh-eval-lab.local/contracts/${name}`);
  assert.ok(validate, `missing validator for ${name}`);
  return validate;
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
    ["registry-snapshot.schema.json", validRegistrySnapshot, parseRegistrySnapshot],
    ["campaign-pointer.schema.json", validCampaignPointerArtifact, parseCampaignPointerArtifact],
    ["qualification.schema.json", validQualificationEvidence, parseQualificationEvidence],
    ["suite-evaluation.schema.json", validSuiteEvaluation, parseSuiteEvaluationArtifact],
    ["suite-report.schema.json", validSuiteReport, parseSuiteReport],
    ["suite-invalid.schema.json", validSuiteInvalidEnvelope, parseSuiteInvalidEnvelope],
  ] as const;
  for (const [schemaName, value, parser] of faces) {
    const validate = await validator(schemaName);
    assert.equal(validate(value), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(parser(value), value);
  }
});

test("Suite faces reject digest, summary, and scheme cross-reference drift", () => {
  const snapshot = structuredClone(validRegistrySnapshot) as Record<string, unknown>;
  (snapshot.digests as { registry: string }).registry = "0".repeat(64);
  assert.throws(() => parseRegistrySnapshot(snapshot));

  const evaluation = structuredClone(validSuiteEvaluation) as Record<string, unknown>;
  (evaluation.summary as { valid_task_count: number }).valid_task_count = 2;
  assert.throws(() => parseSuiteEvaluationArtifact(evaluation));

  const report = structuredClone(validSuiteReport) as Record<string, unknown>;
  const evidence = report.evidence as { manifest: { ref: string } };
  evidence.manifest.ref = "artifact://campaign/manifest.json";
  assert.throws(() => parseSuiteReport(report));
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

test("activation schema and parser reject the same representable drift", async () => {
  const unknown = structuredClone(validActivationArtifact) as Record<string, unknown>;
  ((unknown.events as Record<string, unknown>[])[0] ?? {}).operation = "future-operation";
  const activationValidator = await validator("activation.schema.json");
  assert.equal(activationValidator(unknown), false);
  assert.throws(() => parseActivationArtifact(unknown));

  const inconsistent = structuredClone(validActivationArtifact) as Record<string, unknown>;
  (inconsistent.summary as Record<string, unknown>).activated = false;
  assert.equal(activationValidator(inconsistent), false);
  assert.throws(() => parseActivationArtifact(inconsistent));

  const wrongType = structuredClone(validActivationArtifact) as Record<string, unknown>;
  ((wrongType.events as Record<string, unknown>[])[0] ?? {}).activation_type = "terminal";
  assert.equal(activationValidator(wrongType), false);
  assert.throws(() => parseActivationArtifact(wrongType));
});

test("non-representable activation ordering is enforced by the replay semantic layer", async () => {
  const inconsistent = structuredClone(validActivationArtifact) as Record<string, unknown>;
  (inconsistent.summary as Record<string, unknown>).event_count = 2;
  const validate = await validator("activation.schema.json");
  assert.equal(validate(inconsistent), true);
  const parsed = parseActivationArtifact(inconsistent);
  assert.throws(() => assertActivationArtifactSemantics(parsed));
});

test("Phase 2 refs reject absolute, traversal, backslash, and empty segments", () => {
  for (const ref of ["/tmp/task.md", "../task.md", "task\\task.md", "task//task.md"]) {
    const task = structuredClone(validTaskEntry) as Record<string, unknown>;
    task.public_task_ref = ref;
    assert.throws(() => parseTaskEntry(task));
  }
});

test("exposure rejects reversed timestamps and Suite replay rejects semantic drift", async () => {
  const exposure = structuredClone(validExposureRecord) as Record<string, unknown>;
  exposure.ended_at = "2026-08-17T23:59:00.000Z";
  assert.throws(() => parseExposureRecord(exposure));

  const suite = structuredClone(validSuiteManifest) as Record<string, unknown>;
  const tasks = suite.tasks as Record<string, unknown>[];
  if (tasks[1] !== undefined) tasks[1].task_id = "ledger-audit-v1";
  const validate = await validator("suite-manifest.schema.json");
  assert.equal(validate(suite), true);
  assert.throws(() => assertSuiteManifestSemantics(parseSuiteManifest(suite)));

  const reordered = structuredClone(validSuiteManifest) as Record<string, unknown>;
  (reordered.task_order as string[]).reverse();
  assert.throws(() => assertSuiteManifestSemantics(parseSuiteManifest(reordered)));
});

test("Suite invalid envelope reason/message pairs have JSON Schema and parser parity", async () => {
  const validate = await validator("suite-invalid.schema.json");
  const infrastructure = {
    ...validSuiteInvalidEnvelope,
    reason: "TASK_INFRASTRUCTURE_FAILURE",
    message: "Suite task measurement failed before a valid report could be produced.",
  };
  assert.equal(validate(infrastructure), true, JSON.stringify(validate.errors));
  assert.deepEqual(parseSuiteInvalidEnvelope(infrastructure), infrastructure);

  const mismatched = {
    ...infrastructure,
    message: "Frozen Suite evidence failed integrity or semantic replay.",
  };
  assert.equal(validate(mismatched), false);
  assert.throws(() => parseSuiteInvalidEnvelope(mismatched));
});

test("Suite manifest schema and parser freeze exactly three tasks", async () => {
  const suite = structuredClone(validSuiteManifest) as Record<string, unknown>;
  const tasks = suite.tasks as Record<string, unknown>[];
  tasks.push({
    task_id: "ledger-extra-v1",
    bucket: "trigger",
    campaign_id: "campaign-extra",
  });
  (suite.task_order as string[]).push("ledger-extra-v1");

  const validate = await validator("suite-manifest.schema.json");
  assert.equal(validate(suite), false);
  assert.throws(() => parseSuiteManifest(suite));
});
