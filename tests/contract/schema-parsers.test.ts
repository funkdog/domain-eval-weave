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
  parsePairedEvaluationArtifact,
  parsePairedImpactReport,
  parseVariantSpec,
} from "../../src/contracts/parsers.js";
import {
  validEpisode,
  validEvaluation,
  validExperiment,
  validPairedEvaluation,
  validReport,
  validVariant,
} from "../helpers/fixtures.js";

const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as FormatsPlugin;

const contractCases = [
  ["experiment.schema.json", validExperiment],
  ["episode.schema.json", validEpisode],
  ["evaluation-result.schema.json", validPairedEvaluation],
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

test("evaluation and report schemas share the exact EvaluationResult definition", async () => {
  const [evaluationSource, reportSource] = await Promise.all([
    readFile(new URL("../../contracts/evaluation-result.schema.json", import.meta.url), "utf8"),
    readFile(new URL("../../contracts/report.schema.json", import.meta.url), "utf8"),
  ]);
  const evaluationSchema = JSON.parse(evaluationSource) as {
    $defs: { evaluationResult: unknown };
  };
  const reportSchema = JSON.parse(reportSource) as {
    $defs: { evaluationResult: unknown };
  };
  assert.deepEqual(evaluationSchema.$defs.evaluationResult, reportSchema.$defs.evaluationResult);
});

test("ExperimentSpec rejects unknown fields", async () => {
  const invalid = {
    ...validExperiment,
    general_purpose_registry: true,
  };
  assert.throws(() => parseExperimentSpec(invalid));
  await assertSchemaRejects("experiment.schema.json", invalid);
});

test("VariantSpec freezes the exact Phase 1 deployment face and rejects drift", () => {
  assert.deepEqual(parseVariantSpec(validVariant), validVariant);
  assert.throws(() =>
    parseVariantSpec({
      ...validVariant,
      tools_mode: "compatibility",
    }),
  );
  assert.throws(() =>
    parseVariantSpec({
      ...validVariant,
      undeclared_fallback: true,
    }),
  );
  assert.throws(() =>
    parseVariantSpec({
      ...validVariant,
      expected_goal_rows: { ...validVariant.expected_goal_rows, goal: true },
    }),
  );
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

test("EpisodeRecord schema and parser freeze normalized measurement facts", async () => {
  for (const measurement of [
    { ...validEpisode.measurement, candidate_frozen_before_oracle: false },
    { ...validEpisode.measurement, candidate_changed_paths: ["src/../outside.ts"] },
  ]) {
    const invalid = { ...validEpisode, measurement };
    assert.throws(() => parseEpisodeRecord(invalid));
    await assertSchemaRejects("episode.schema.json", invalid);
  }
});

test("EvaluationResult rejects non-finite observed numbers", async () => {
  const invalid = {
    ...validPairedEvaluation,
    arms: {
      ...validPairedEvaluation.arms,
      control: {
        ...validPairedEvaluation.arms.control,
        result: {
          ...validEvaluation,
          cost: {
            ...validEvaluation.cost,
            elapsed_ms: Number.POSITIVE_INFINITY,
          },
        },
      },
    },
  };
  assert.throws(() => parsePairedEvaluationArtifact(invalid));
  await assertSchemaRejects("evaluation-result.schema.json", invalid);
});

test("verified completion requires all eight passing behaviors and the path gate", async () => {
  const invalid = {
    ...validPairedEvaluation,
    arms: {
      ...validPairedEvaluation.arms,
      control: {
        ...validPairedEvaluation.arms.control,
        result: {
          ...validEvaluation,
          outcome: {
            ...validEvaluation.outcome,
            behavior_vector: { basic_reservation: "pass" },
          },
        },
      },
    },
  };
  assert.throws(() => parsePairedEvaluationArtifact(invalid));
  await assertSchemaRejects("evaluation-result.schema.json", invalid);
});

test("paired evaluation schema and parser reject unbound candidate evidence", async () => {
  const invalid = {
    ...validPairedEvaluation,
    arms: {
      ...validPairedEvaluation.arms,
      control: {
        ...validPairedEvaluation.arms.control,
        candidate: {
          ...validPairedEvaluation.arms.control.candidate,
          archive: {
            ref: "arms/control/candidate.tar",
            sha256: validPairedEvaluation.arms.control.candidate.archive.sha256,
          },
        },
      },
    },
  };
  assert.throws(() => parsePairedEvaluationArtifact(invalid));
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
  assert.deepEqual(parsePairedEvaluationArtifact(validPairedEvaluation), validPairedEvaluation);
  assert.deepEqual(parsePairedImpactReport(validReport), validReport);
});
