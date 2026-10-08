import assert from "node:assert/strict";
import test from "node:test";

import { assertNoJudgeTools } from "../../src/carrier/dsh-judge.js";

test("Judge no-tools transport accepts omitted or empty catalogs and rejects every exposed tool", () => {
  assert.doesNotThrow(() => assertNoJudgeTools(undefined));
  assert.doesNotThrow(() => assertNoJudgeTools([]));
  assert.throws(() => assertNoJudgeTools(null), /exposed tools/);
  assert.throws(() => assertNoJudgeTools([{ name: "read" }]), /exposed tools/);
});
