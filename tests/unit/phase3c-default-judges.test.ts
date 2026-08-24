import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "../../src/contracts/canonical-json.js";
import {
  CODE_QUALITY_DIMENSIONS,
  CODE_QUALITY_JUDGE_PROMPT,
  createCodeQualityJudgeContract,
  createSemanticJudgeContract,
  SEMANTIC_DIMENSIONS,
  SEMANTIC_JUDGE_PROMPT,
} from "../../src/phase3c/index.js";

const sha = (value: string) => value.repeat(64);

test("frozen Judge factories bind complete independent rubrics and prompt bytes", () => {
  const semantic = createSemanticJudgeContract({
    outputSchemaSha256: sha("1"),
    calibrationAdmissionSha256: sha("2"),
  });
  const quality = createCodeQualityJudgeContract({
    outputSchemaSha256: sha("3"),
    calibrationAdmissionSha256: sha("4"),
  });
  assert.deepEqual(
    semantic.dimensions.map((entry) => entry.dimension_id),
    SEMANTIC_DIMENSIONS,
  );
  assert.deepEqual(
    quality.dimensions.map((entry) => entry.dimension_id),
    CODE_QUALITY_DIMENSIONS,
  );
  assert.equal(semantic.prompt_sha256, sha256Hex(SEMANTIC_JUDGE_PROMPT));
  assert.equal(quality.prompt_sha256, sha256Hex(CODE_QUALITY_JUDGE_PROMPT));
  assert.notEqual(semantic.prompt_sha256, quality.prompt_sha256);
  assert.ok(quality.dimensions.every((entry) => entry.conditions.length === 2));
  assert.ok(
    quality.dimensions.every(
      (entry) =>
        entry.conditions.some((condition) => condition.level === "blocking") &&
        entry.conditions.some((condition) => condition.level === "concern"),
    ),
  );
});
