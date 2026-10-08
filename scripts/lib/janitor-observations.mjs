import assert from "node:assert/strict";

export const janitorGraderVersion = "janitor-vector-v1";

// Pure interpretation of saved observations; no JVM, model, workspace or hidden current labels.
export function gradeJanitorEvidence(contract, evidence) {
  assert.equal(contract.format, "janitor-local-task-contract-v1");
  assert.equal(contract.amount_comparison, "decimal_value_ignore_trailing_zero_scale");
  const invalid = (diagnostic) => ({
    measurement_validity: "invalid",
    verdict: "inconclusive",
    diagnostic,
    checks: [],
  });
  const processOk = (p) =>
    p?.exitCode === 0 &&
    p.signal === null &&
    p.timedOut === false &&
    p.outputLimitExceeded === false;
  if (!processOk(evidence.compile)) return invalid("compile_or_environment_failure");
  if (!processOk(evidence.execution)) return invalid("execution_or_environment_failure");
  let rows;
  try {
    assert.equal(typeof evidence.execution.stdout, "string");
    const lines = evidence.execution.stdout.trim().split("\n");
    const [begin, token, extra] = lines[0].split("\t");
    assert.ok(begin === "BEGIN" && !extra && /^[0-9a-f-]{36}$/.test(token ?? ""));
    assert.equal(lines.at(-1), `END\t${token}`);
    rows = lines
      .slice(1, -1)
      .filter((line) => line.startsWith(`${token}\t`))
      .map((line) => JSON.parse(line.slice(token.length + 1)));
    assert.deepEqual(
      rows.map((row) => row.scenario),
      contract.observation.cases,
    );
    for (const row of rows) {
      for (const field of [
        "payment_state",
        "transaction_status",
        "processed_amount",
        "processed_currency",
      ])
        assert.equal(typeof row[field], "string");
      assert.ok(row.last_success === null || typeof row.last_success === "string");
      assert.equal(typeof row.changed, "boolean");
      for (const field of ["updates", "acquired", "released"])
        assert.ok(Number.isSafeInteger(row[field]) && row[field] >= 0);
      assert.equal(row.old_snapshot_unchanged, true);
      assert.equal(row.lock_held, false);
      assert.equal(row.acquired, row.released);
      assert.equal(row.transaction_id, "00000000-0000-0000-0000-000000000003");
      assert.ok(Array.isArray(row.trace) && row.trace.every((entry) => typeof entry === "string"));
      assert.equal(row.trace.filter((s) => s === "acquired").length, row.acquired);
      assert.equal(row.trace.filter((s) => s === "released").length, row.released);
      if (row.scenario === "concurrent_capture") {
        const opportunity = row.trace.indexOf("other-operation:AUTH_SUCCESS->CAPTURE_SUCCESS");
        assert.ok(opportunity >= 0 && opportunity < row.trace.indexOf("acquired"));
      }
    }
  } catch {
    return invalid("observation_protocol_or_guard_incomplete");
  }
  const checks = rows.map((row) => {
    const differences = Object.entries(contract.expected[row.scenario])
      .filter(([field, value]) => {
        if (field !== "processed_amount") return row[field] !== value;
        assert.ok(value === "0" || value === "10.00", "unsupported frozen amount predicate");
        return !(value === "0" ? /^0(?:\.0+)?$/ : /^10(?:\.0+)?$/).test(row[field]);
      })
      .map(([field, expected]) => ({ field, expected, observed: row[field] }));
    return { scenario: row.scenario, verdict: differences.length ? "fail" : "pass", differences };
  });
  return {
    measurement_validity: "valid",
    verdict: checks.every((c) => c.verdict === "pass") ? "pass" : "fail",
    diagnostic: "state_updates_observed",
    checks,
  };
}
