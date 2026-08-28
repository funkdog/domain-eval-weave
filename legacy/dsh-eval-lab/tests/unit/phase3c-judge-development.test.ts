import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  buildDefaultJudgeDevelopmentSet,
  getJudgeDevelopmentCases,
  judgeDevelopmentCaseInput,
  parseJudgeCaseInputSet,
} from "../../src/phase3c/index.js";

test("Judge development cohorts are concrete, disjoint, and cover required case classes", () => {
  const semantic = buildDefaultJudgeDevelopmentSet("semantic");
  const quality = buildDefaultJudgeDevelopmentSet("code_quality");
  assert.deepEqual(parseJudgeCaseInputSet(semantic), semantic);
  assert.deepEqual(parseJudgeCaseInputSet(quality), quality);
  assert.equal(semantic.cases.length, 6);
  assert.equal(quality.cases.length, 8);

  const allDigests = [...semantic.cases, ...quality.cases].map(
    (entry) => entry.input_closure_sha256,
  );
  assert.equal(new Set(allDigests).size, allDigests.length);
  for (const kind of ["semantic", "code_quality"] as const) {
    const cases = getJudgeDevelopmentCases(kind);
    assert.ok(cases.some((entry) => entry.riskClass === "critical"));
    assert.ok(cases.some((entry) => entry.riskClass === "standard"));
    for (const entry of cases) {
      const registered = (kind === "semantic" ? semantic : quality).cases.find(
        (candidate) => candidate.case_id === entry.caseId,
      );
      assert.equal(
        registered?.input_closure_sha256,
        canonicalJsonDigest(judgeDevelopmentCaseInput(entry)),
      );
    }
  }
});

test("development cohorts include decide, abstain, bias, blocking, and concern expectations", () => {
  const semantic = getJudgeDevelopmentCases("semantic");
  const quality = getJudgeDevelopmentCases("code_quality");
  assert.ok(
    semantic.some((entry) => entry.expectedDimensions.some((item) => item.verdict === "pass")),
  );
  assert.ok(
    semantic.some((entry) => entry.expectedDimensions.some((item) => item.verdict === "fail")),
  );
  assert.ok(
    semantic.some((entry) => entry.expectedDimensions.some((item) => item.verdict === "abstain")),
  );
  assert.ok(semantic.some((entry) => entry.candidateCode.includes("JUDGE:")));
  assert.ok(
    quality.some((entry) => entry.expectedDimensions.some((item) => item.severity === "blocking")),
  );
  assert.ok(
    quality.some((entry) => entry.expectedDimensions.some((item) => item.severity === "concern")),
  );
});
