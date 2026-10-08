import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../packages/weave/src/capsule/artifact-store.ts";

// Assessment of retained development evidence only: does not execute Java or an Agent.
const [reportPath] = process.argv.slice(2);
const path = await realpath(reportPath);
assert.equal(path, resolve(reportPath));
const rel = relative("/Users/slipshod/AIBuild/dsh-eval-lab-runtime", path);
assert.ok(rel && !rel.startsWith("..") && !rel.startsWith("/"));
const report = JSON.parse(await readFile(path, "utf8"));
const { digest, ...body } = report;
assert.equal(canonicalJsonDigest(body), digest, "raw report drift");
assert.equal(report.root, dirname(path));
const dependencyLock = JSON.parse(
  await readFile(
    new URL(
      "../packages/weave/examples/killbill-janitor-recovery/dependency-lock.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(report.dependencies.artifacts, dependencyLock.artifacts);
const driver = await readFile(new URL("./fixtures/JanitorProbe.java", import.meta.url), "utf8");
assert.equal(sha256Hex(driver), report.driver_sha256);
const cases = [
  "concurrent_capture",
  "normal_recovery",
  "unresolved",
  "pending_unchanged",
  "lock_failure",
];
const variants = [
  "upstream_reference",
  "stale_snapshot_regression",
  "never_recover",
  "authored_equivalent",
];
assert.deepEqual(
  report.observations.map((row) => row.name),
  variants,
);
const expected = {
  concurrent_capture: {
    payment_state: "CAPTURE_SUCCESS",
    last_success: "CAPTURE_SUCCESS",
    transaction_status: "SUCCESS",
    transaction_count: 2,
    updates: 0,
    changed: false,
  },
  normal_recovery: {
    payment_state: "AUTH_SUCCESS",
    last_success: "AUTH_SUCCESS",
    transaction_status: "SUCCESS",
    transaction_count: 1,
    updates: 1,
    changed: true,
  },
  unresolved: {
    payment_state: "AUTH_ERRORED",
    last_success: null,
    transaction_status: "UNKNOWN",
    transaction_count: 1,
    updates: 0,
    changed: false,
  },
  pending_unchanged: {
    payment_state: "AUTH_PENDING",
    last_success: null,
    transaction_status: "PENDING",
    transaction_count: 1,
    updates: 0,
    changed: false,
  },
  lock_failure: {
    payment_state: "AUTH_ERRORED",
    last_success: null,
    transaction_status: "UNKNOWN",
    transaction_count: 1,
    updates: 0,
    changed: false,
  },
};
const results = [];
const sourceSnapshots = {};
for (const evidence of report.observations) {
  assert.equal(evidence.measurement_valid, true);
  for (const process of [evidence.compile, evidence.execution]) {
    assert.equal(process.exitCode, 0);
    assert.equal(process.signal, null);
    assert.equal(process.timedOut, false);
    assert.equal(process.outputLimitExceeded, false);
  }
  const lines = evidence.execution.stdout.trim().split("\n");
  const [begin, token] = lines[0].split("\t");
  assert.equal(begin, "BEGIN");
  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.equal(lines.at(-1), `END\t${token}`);
  const parsed = lines
    .slice(1, -1)
    .filter((line) => line.startsWith(`${token}\t`))
    .map((line) => JSON.parse(line.slice(token.length + 1)));
  assert.deepEqual(parsed, evidence.rows, "stored rows differ from actual process output");
  assert.deepEqual(
    parsed.map((row) => row.scenario),
    cases,
  );
  const source = await readFile(
    join(report.root, evidence.name, "IncompletePaymentTransactionTask.java"),
    "utf8",
  );
  assert.equal(sha256Hex(source), evidence.source_sha256);
  sourceSnapshots[evidence.name] = source;
  const checks = parsed.map((row) => {
    assert.equal(row.old_snapshot_unchanged, true, "mutable fixture aliased the old snapshot");
    assert.equal(row.lock_held, false);
    assert.equal(row.acquired, row.released);
    assert.equal(row.transaction_id, "00000000-0000-0000-0000-000000000003");
    if (row.scenario === "concurrent_capture") {
      const advance = row.trace.indexOf("other-operation:AUTH_SUCCESS->CAPTURE_SUCCESS");
      assert.ok(
        advance >= 0 && advance < row.trace.indexOf("acquired"),
        "race opportunity did not form",
      );
    }
    const differences = Object.entries(expected[row.scenario])
      .filter(([key, value]) => row[key] !== value)
      .map(([field, value]) => ({ field, expected: value, observed: row[field] }));
    const amount = ["concurrent_capture", "normal_recovery"].includes(row.scenario)
      ? /^10(?:\.0+)?$/
      : /^0(?:\.0+)?$/;
    if (!amount.test(row.processed_amount))
      differences.push({
        field: "processed_amount",
        expected:
          row.scenario === "normal_recovery" || row.scenario === "concurrent_capture"
            ? "10 EUR"
            : "0 EUR",
        observed: row.processed_amount,
      });
    if (row.processed_currency !== "EUR")
      differences.push({
        field: "processed_currency",
        expected: "EUR",
        observed: row.processed_currency,
      });
    return { scenario: row.scenario, verdict: differences.length ? "fail" : "pass", differences };
  });
  results.push({
    variant: evidence.name,
    checks,
    failed_scenarios: checks.filter((c) => c.verdict === "fail").map((c) => c.scenario),
  });
}
const gates = {
  reference_preserves_safety_and_progress: results[0].failed_scenarios.length === 0,
  stale_snapshot_reproduces_only_race_failure:
    JSON.stringify(results[1].failed_scenarios) === JSON.stringify(["concurrent_capture"]),
  never_recover_is_rejected_by_progress:
    JSON.stringify(results[2].failed_scenarios) === JSON.stringify(["normal_recovery"]),
  equivalent_implementation_accepted: results[3].failed_scenarios.length === 0,
  transaction_success_alone_would_miss_bug:
    report.observations[0].rows[0].transaction_status === "SUCCESS" &&
    report.observations[1].rows[0].transaction_status === "SUCCESS",
};
const assessment = {
  format: "janitor-development-assessment-v1",
  raw_report: report,
  source_snapshots: sourceSnapshots,
  driver_source: driver,
  dependency_lock: dependencyLock,
  expected,
  results,
  gates,
  feasibility_ready: Object.values(gates).every(Boolean),
  assessor_sha256: sha256Hex(await readFile(new URL(import.meta.url))),
  scope: "on-the-fly-core-with-in-memory-DAO-and-controlled-lock",
  agent_execution: "not_observed",
  qualification: "not_qualified",
};
const assessed = { ...assessment, digest: canonicalJsonDigest(assessment) };
const output = join(report.root, `assessment-${assessed.digest}.json`);
await writeExclusiveOrVerify(
  output,
  Buffer.from(`${canonicalJson(assessed)}\n`),
  () => new Error("assessment collision"),
);
console.log(
  JSON.stringify(
    {
      output,
      digest: assessed.digest,
      feasibility_ready: assessed.feasibility_ready,
      gates,
      results: results.map(({ variant, failed_scenarios }) => ({ variant, failed_scenarios })),
    },
    null,
    2,
  ),
);
if (!assessed.feasibility_ready) process.exitCode = 1;
