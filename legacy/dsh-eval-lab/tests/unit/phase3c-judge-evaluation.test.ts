import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import { canonicalJsonDigest, sha256Hex } from "../../src/contracts/canonical-json.js";
import {
  createSemanticJudgeContract,
  type JudgeCarrier,
  judgeDefinitionDigest,
  runAdmittedJudgeEvaluation,
  SEMANTIC_JUDGE_PROMPT,
} from "../../src/phase3c/index.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { validPhase3cSemanticAdmission } from "../helpers/phase3c-fixtures.js";

const sha = (value: string) => value.repeat(64);
const pointer = (ref: string, digest: string) => ({ ref, sha256: digest });

test("admitted Judge evaluation persists three independent runs and one aggregate", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/phase3c-judge-evaluation-`);
  const outputSchemaBytes = '{"type":"object"}\n';
  const definition = createSemanticJudgeContract({
    outputSchemaSha256: sha256Hex(outputSchemaBytes),
    calibrationAdmissionSha256: sha("0"),
  });
  const admission = {
    ...validPhase3cSemanticAdmission,
    judge_definition_sha256: judgeDefinitionDigest(definition),
  };
  const contract = createSemanticJudgeContract({
    outputSchemaSha256: sha256Hex(outputSchemaBytes),
    calibrationAdmissionSha256: canonicalJsonDigest(admission),
  });
  const manifest = {
    schema_version: 1 as const,
    judge_kind: "semantic" as const,
    candidate_archive: pointer("artifact://campaign/candidate/archive.tar", sha("1")),
    candidate_diff: pointer("artifact://campaign/candidate/diff.patch", sha("2")),
    base_tree: pointer("artifact://campaign/candidate/base.json", sha("3")),
    public_task: pointer("artifact://campaign/source/task.md", sha("4")),
    untrusted_candidate_content: true as const,
    requirement: pointer("artifact://campaign/source/requirement.json", sha("5")),
    domain_refs: [pointer("artifact://campaign/source/domain.json", sha("6"))],
    semantic_residual_claim_ids: ["semantic-residual-one"],
    judge_contract: pointer(
      "artifact://campaign/phase3c/semantic-judge/contract.json",
      canonicalJsonDigest(contract),
    ),
  };
  const carrier = (repeatIndex: 1 | 2 | 3): JudgeCarrier => ({
    async run() {
      return {
        sessionId: `synthetic-session-${repeatIndex}`,
        sessionTranscriptSha256: sha(String(repeatIndex)),
        sessionProtocolValid: true,
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({
          schema_version: 1,
          judge_kind: "semantic",
          judge_contract_sha256: canonicalJsonDigest(contract),
          input_manifest_sha256: canonicalJsonDigest(manifest),
          dimensions: contract.dimensions.map((dimension) => ({
            dimension_id: dimension.dimension_id,
            applicability: "applicable",
            verdict: "pass",
            severity: "none",
            matched_condition_ids: [],
            evidence: [
              {
                source_ref: "artifact://campaign/candidate/diff.patch",
                locator: "src/order.ts:1",
              },
            ],
            rationale: "The synthetic evidence satisfies this frozen dimension.",
            counterevidence: null,
            abstention_reason: null,
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
  let tick = 0;
  try {
    const result = await runAdmittedJudgeEvaluation({
      campaignRoot: root,
      evaluationId: "synthetic-evaluation",
      contract,
      admission,
      promptTemplate: SEMANTIC_JUDGE_PROMPT,
      inputManifest: manifest,
      outputSchemaBytes,
      materials: [
        {
          role: "candidate_code",
          sourceRef: manifest.candidate_diff.ref,
          content: "export const cancellation = true;",
        },
      ],
      carrier,
      clock: () => `2026-08-24T00:00:0${tick++}.000Z`,
      timeoutMs: 60_000,
    });
    assert.equal(result.validity, "valid");
    assert.ok(result.aggregate);
    assert.equal(result.aggregate.run_receipts.length, 3);
    assert.equal(new Set(result.aggregate.run_receipts.map((entry) => entry.ref)).size, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
