import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import * as addFormatsModule from "ajv-formats";

import {
  parseEpisodeRecord,
  parseEvaluationResult,
  parseExperimentSpec,
  parsePairedImpactReport,
} from "../../src/contracts/parsers.js";
import {
  validEpisode,
  validEvaluation,
  validExperiment,
  validReport,
} from "../helpers/fixtures.js";

const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as FormatsPlugin;

const contractCases = [
  ["experiment.schema.json", validExperiment],
  ["episode.schema.json", validEpisode],
  ["evaluation-result.schema.json", validEvaluation],
  ["report.schema.json", validReport],
] as const;

async function assertSchemaRejects(schemaName: string, value: unknown): Promise<void> {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  addFormats(ajv);
  const source = await readFile(new URL(`../../contracts/${schemaName}`, import.meta.url), "utf8");
  const validate = ajv.compile(JSON.parse(source));
  assert.equal(validate(value), false, `${schemaName} unexpectedly accepted invalid data`);
}

test("the four JSON Schema faces accept their canonical fixtures", async () => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  addFormats(ajv);

  for (const [schemaName, fixture] of contractCases) {
    const source = await readFile(
      new URL(`../../contracts/${schemaName}`, import.meta.url),
      "utf8",
    );
    const validate = ajv.compile(JSON.parse(source));
    assert.equal(validate(fixture), true, `${schemaName}: ${ajv.errorsText(validate.errors)}`);
  }
});

test("ExperimentSpec rejects unknown fields", async () => {
  const invalid = {
    ...validExperiment,
    general_purpose_registry: true,
  };
  assert.throws(() => parseExperimentSpec(invalid));
  await assertSchemaRejects("experiment.schema.json", invalid);
});

test("ExperimentSpec schema and parser reject impossible calendar dates", async () => {
  const invalid = {
    ...validExperiment,
    created_at: "2026-02-30T08:00:00.000Z",
  };
  assert.throws(() => parseExperimentSpec(invalid));
  await assertSchemaRejects("experiment.schema.json", invalid);
});

test("EpisodeRecord rejects raw relative artifact references", async () => {
  const invalid = {
    ...validEpisode,
    evidence: {
      ...validEpisode.evidence,
      session_log_ref: "arms/control/session.jsonl",
    },
  };
  assert.throws(() => parseEpisodeRecord(invalid));
  await assertSchemaRejects("episode.schema.json", invalid);
});

test("EpisodeRecord schema and parser reject non-normalized artifact paths", async () => {
  for (const sessionLogRef of [
    "artifact://campaign/../session.jsonl",
    "artifact://campaign/arms//session.jsonl",
    "artifact://campaign/arms/./session.jsonl",
  ]) {
    const invalid = {
      ...validEpisode,
      evidence: {
        ...validEpisode.evidence,
        session_log_ref: sessionLogRef,
      },
    };
    assert.throws(() => parseEpisodeRecord(invalid));
    await assertSchemaRejects("episode.schema.json", invalid);
  }
});

test("EvaluationResult rejects non-finite observed numbers", async () => {
  const invalid = {
    ...validEvaluation,
    cost: {
      ...validEvaluation.cost,
      elapsed_ms: Number.POSITIVE_INFINITY,
    },
  };
  assert.throws(() => parseEvaluationResult(invalid));
  await assertSchemaRejects("evaluation-result.schema.json", invalid);
});

test("PairedImpactReport rejects unsupported effect claims", async () => {
  const invalid = {
    ...validReport,
    effect_claim_eligible: true,
  };
  assert.throws(() => parsePairedImpactReport(invalid));
  await assertSchemaRejects("report.schema.json", invalid);
});

test("strict parsers accept all four canonical fixtures", () => {
  assert.deepEqual(parseExperimentSpec(validExperiment), validExperiment);
  assert.deepEqual(parseEpisodeRecord(validEpisode), validEpisode);
  assert.deepEqual(parseEvaluationResult(validEvaluation), validEvaluation);
  assert.deepEqual(parsePairedImpactReport(validReport), validReport);
});
