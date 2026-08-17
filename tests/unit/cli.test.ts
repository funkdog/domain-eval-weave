import assert from "node:assert/strict";
import test from "node:test";

import { EXIT_CODE, main } from "../../src/cli/main.js";

function captureIo(): {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly io: { out(message: string): void; err(message: string): void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      out: (message) => stdout.push(message),
      err: (message) => stderr.push(message),
    },
  };
}

test("CLI help succeeds without touching runtime state", async () => {
  const capture = captureIo();
  assert.equal(await main(["--help"], capture.io), EXIT_CODE.OK);
  assert.match(capture.stdout.join("\n"), /dsh-eval doctor/);
  assert.deepEqual(capture.stderr, []);
});

test("CLI rejects unknown commands with the stable usage exit code", async () => {
  const capture = captureIo();
  assert.equal(await main(["unknown"], capture.io), EXIT_CODE.USAGE_OR_CONTRACT);
  assert.match(capture.stderr.join("\n"), /CLI_USAGE/);
});

test("Milestone 0 command routes fail explicitly with their stable error families", async () => {
  const cases = [
    [["doctor"], EXIT_CODE.RUNTIME_NOT_READY],
    [["calibrate"], EXIT_CODE.CALIBRATION_NOT_READY],
    [["run"], EXIT_CODE.CAMPAIGN_INFRASTRUCTURE_INVALID],
    [["report", "campaign-m0"], EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE],
  ] as const;

  for (const [args, expected] of cases) {
    const capture = captureIo();
    assert.equal(await main([...args], capture.io), expected);
    assert.match(capture.stderr.join("\n"), /NOT_IMPLEMENTED_MILESTONE_0/);
  }
});

test("run rejects unknown options with the usage exit code", async () => {
  const capture = captureIo();
  assert.equal(await main(["run", "--unknown"], capture.io), EXIT_CODE.USAGE_OR_CONTRACT);
  assert.match(capture.stderr.join("\n"), /CLI_USAGE/);
});

test("run skeleton recognizes only the frozen Phase 1 options", async () => {
  const capture = captureIo();
  assert.equal(
    await main(
      [
        "run",
        "--runtime-root",
        "/Users/slipshod/AIBuild/dsh-eval-lab-runtime",
        "--timeout-ms",
        "5400000",
        "--keep-workspaces",
      ],
      capture.io,
    ),
    EXIT_CODE.CAMPAIGN_INFRASTRUCTURE_INVALID,
  );
  assert.match(capture.stderr.join("\n"), /NOT_IMPLEMENTED_MILESTONE_0/);
});
