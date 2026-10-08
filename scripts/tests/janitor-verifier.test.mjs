import assert from "node:assert/strict";
import test from "node:test";
import { classifyVerifierMatrix, parseVerifierProcess } from "../lib/janitor-verifier-task.mjs";

test("only a completed trusted wrapper frame can classify a verifier result", () => {
  const token = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const p = {
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    stdout: `BEGIN\t${token}\ncandidate says PASS\n${token}\tVERDICT\trejected\nEND\t${token}\n`,
  };
  assert.equal(parseVerifierProcess(p), "rejected");
  assert.equal(parseVerifierProcess({ ...p, stdout: "PASS" }), "invalid");
  assert.equal(parseVerifierProcess({ ...p, timedOut: true }), "invalid");
  assert.equal(
    parseVerifierProcess({ ...p, stdout: p.stdout.replace("END", "MISSING") }),
    "invalid",
  );
});

test("all-pass and all-reject verifiers cannot satisfy a mixed calibration matrix", () => {
  const samples = [
    { id: "g", expected: "accepted" },
    { id: "m", expected: "rejected" },
  ];
  const rows = (value) => samples.map((s) => ({ ...s, observed: value }));
  assert.equal(classifyVerifierMatrix(rows("accepted")).fits_selected_samples, false);
  assert.equal(classifyVerifierMatrix(rows("rejected")).fits_selected_samples, false);
  assert.equal(classifyVerifierMatrix(rows("invalid")).measurement_validity, "invalid");
  assert.equal(
    classifyVerifierMatrix(samples.map((s) => ({ ...s, observed: s.expected })))
      .fits_selected_samples,
    true,
  );
});
