import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import {
  PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  parseCodeQualityJudgeRunResult,
  parseHarnessEffectContract,
  parseObservationAuthorityMap,
  parseObservationBoundarySpec,
  parsePhase3cDeliveryReport,
  parsePublicObservationCatalog,
  parseSemanticJudgeRunResult,
} from "../../src/phase3c/index.js";
import {
  validPhase3cAuthorityMap,
  validPhase3cBoundary,
  validPhase3cCodeQualityResult,
  validPhase3cHarnessEffectContract,
  validPhase3cReport,
  validPhase3cSemanticResult,
} from "../helpers/phase3c-fixtures.js";

const faces = [
  ["public-observation-catalog", PHASE3C_PUBLIC_OBSERVATION_CATALOG, parsePublicObservationCatalog],
  ["observation-authority-map", validPhase3cAuthorityMap, parseObservationAuthorityMap],
  ["observation-boundary", validPhase3cBoundary, parseObservationBoundarySpec],
  ["semantic-judge-run-result", validPhase3cSemanticResult, parseSemanticJudgeRunResult],
  ["code-quality-judge-run-result", validPhase3cCodeQualityResult, parseCodeQualityJudgeRunResult],
  ["harness-effect-contract", validPhase3cHarnessEffectContract, parseHarnessEffectContract],
  ["delivery-evaluation-report", validPhase3cReport, parsePhase3cDeliveryReport],
] as const;

const expectedSchemaFiles = [
  "code-quality-judge-contract.schema.json",
  "code-quality-judge-input-manifest.schema.json",
  "code-quality-judge-result.schema.json",
  "code-quality-judge-run-result.schema.json",
  "delivery-evaluation-report.schema.json",
  "deterministic-observation-result.schema.json",
  "domain-observation-normal-form.schema.json",
  "harness-effect-contract.schema.json",
  "judge-admission.schema.json",
  "judge-case-input-set.schema.json",
  "judge-execution-manifest.schema.json",
  "judge-freeze-receipt.schema.json",
  "judge-label-set.schema.json",
  "judge-labels-unseal-receipt.schema.json",
  "judge-run-descriptor.schema.json",
  "judge-run-receipt.schema.json",
  "observation-authority-map.schema.json",
  "observation-boundary-admission.schema.json",
  "observation-boundary.schema.json",
  "public-observation-catalog.schema.json",
  "semantic-judge-contract.schema.json",
  "semantic-judge-input-manifest.schema.json",
  "semantic-judge-result.schema.json",
  "semantic-judge-run-result.schema.json",
  "tdd-skill-binding.schema.json",
  "tdd-skill-deployment.schema.json",
  "tdd-task-registry.schema.json",
] as const;

test("Phase 3C schema generator has one closed output set with no orphan files", async () => {
  const root = new URL("../../contracts/phase3c/", import.meta.url);
  assert.deepEqual((await readdir(root)).sort(), expectedSchemaFiles);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const name of expectedSchemaFiles) {
    const schema = JSON.parse(await readFile(new URL(name, root), "utf8"));
    assert.doesNotThrow(() => ajv.compile(schema), name);
  }
});

test("Phase 3C persisted faces have JSON Schema and runtime parser parity", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const [name, value, parser] of faces) {
    const schema = JSON.parse(
      await readFile(
        new URL(`../../contracts/phase3c/${name}.schema.json`, import.meta.url),
        "utf8",
      ),
    );
    const validate = ajv.compile(schema);
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(parser(value), value);
    const extra = { ...value, aggregate_score: 100 };
    assert.equal(validate(extra), false, `${name} accepted an unknown score`);
    assert.throws(() => parser(extra));
  }
});
