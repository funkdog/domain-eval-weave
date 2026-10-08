import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import { writeArtifactBytes, writeCanonicalJsonArtifact } from "../../src/contracts/artifacts.js";
import { canonicalJsonDigest, sha256Hex } from "../../src/contracts/canonical-json.js";
import {
  createSemanticJudgeContract,
  developmentCaseMatches,
  developmentJudgeCaseSource,
  executeJudgeCase,
  getJudgeDevelopmentCases,
  type JudgeCarrier,
  SEMANTIC_JUDGE_PROMPT,
} from "../../src/phase3c/index.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

test("Judge cohort materializes one concrete development closure and preserves exact decisions", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/judge-cohort-`);
  const outputSchemaBytes = '{"type":"object"}';
  const contract = createSemanticJudgeContract({
    outputSchemaSha256: sha256Hex(outputSchemaBytes),
    calibrationAdmissionSha256: "0".repeat(64),
  });
  const sourceCase = getJudgeDevelopmentCases("semantic")[0];
  if (sourceCase === undefined) throw new Error("semantic development case is missing");
  const source = developmentJudgeCaseSource(sourceCase);
  try {
    const [contractPointer, promptPointer, outputSchemaPointer] = await Promise.all([
      writeCanonicalJsonArtifact(
        root,
        "artifact://campaign/phase3c/judge-cohort/semantic/contract.json",
        contract,
      ),
      writeArtifactBytes(
        root,
        "artifact://campaign/phase3c/judge-cohort/semantic/prompt.txt",
        SEMANTIC_JUDGE_PROMPT,
      ),
      writeArtifactBytes(
        root,
        "artifact://campaign/phase3c/judge-cohort/semantic/output-schema.json",
        outputSchemaBytes,
      ),
    ]);
    const attempts = new Map<number, number>();
    const carrier = (repeat: number): JudgeCarrier => ({
      async run(input) {
        const attempt = (attempts.get(repeat) ?? 0) + 1;
        attempts.set(repeat, attempt);
        const manifestDigest = input.prompt.match(/<input-manifest sha256="([a-f0-9]{64})">/)?.[1];
        if (manifestDigest === undefined) throw new Error("prompt omitted manifest digest");
        return {
          sessionId: `synthetic-cohort-${repeat}`,
          sessionTranscriptSha256: String(repeat).repeat(64),
          sessionProtocolValid: repeat !== 1 || attempt > 1,
          exitCode: 0,
          signal: null,
          stdout: JSON.stringify({
            schema_version: 1,
            judge_kind: "semantic",
            judge_contract_sha256: canonicalJsonDigest(contract),
            input_manifest_sha256: manifestDigest,
            dimensions: sourceCase.expectedDimensions.map((dimension) => ({
              ...dimension,
              evidence:
                dimension.verdict === "abstain"
                  ? []
                  : [
                      {
                        source_ref:
                          "artifact://campaign/phase3c/judge-cohort/semantic/cases/semantic-dev-typed-rejection-equivalent/candidate.diff",
                        locator: "src/order-service.ts:1",
                      },
                    ],
              rationale: "Synthetic development evidence matches the frozen expectation.",
              counterevidence: null,
            })),
            protocol_status: "valid",
          }),
          stderr: "",
          timedOut: false,
          outputLimitExceeded: false,
          observedModelRoute: contract.model_route,
        };
      },
    });
    const execution = await executeJudgeCase({
      campaignRoot: root,
      cohortId: "development-semantic",
      source,
      contract,
      contractPointer,
      promptTemplate: SEMANTIC_JUDGE_PROMPT,
      promptPointer,
      outputSchemaBytes,
      outputSchemaPointer,
      carrier,
      timeoutMs: 60_000,
      maxAttemptsPerRepeat: 2,
      retryDelaysMs: [0],
      clock: () => "2026-08-25T00:00:00.000Z",
    });
    assert.equal(developmentCaseMatches(sourceCase, execution), true);
    assert.equal(execution.attempt_receipts.length, 4);
    assert.equal(execution.run_receipts.length, 3);
    assert.equal(new Set(execution.run_receipts.map((entry) => entry.ref)).size, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
