import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { delimiter, join } from "node:path";
import { StrictProcessRunner } from "../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../packages/weave/src/capsule/artifact-store.ts";
import { loadJanitorTask } from "./lib/janitor-coding-task.mjs";
import { fingerprintJdk } from "./lib/killbill-status-profile.mjs";

// Model-free author fixture calibration. No old task mutation or consumer launch.
const [template] = process.argv.slice(2);
assert.ok(template && process.argv.length === 3, "requires the existing frozen Janitor task root");
const { root: oldRoot, task } = await loadJanitorTask(template);
assert.deepEqual(task.environment.host, { platform: platform(), arch: arch(), kernel: release() });
assert.deepEqual(await fingerprintJdk(task.environment.java_home), task.environment.fingerprint);
assert.equal(task.digest, "6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8");
const sanctuary = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
assert.equal(await realpath(sanctuary), sanctuary);
const root = await mkdtemp(join(sanctuary, "janitor-money-probe."));
const put = async (path, data) => {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(
    path,
    Buffer.from(data),
    () => new Error("immutable probe collision"),
  );
};
console.log(JSON.stringify({ root }));
const raw = await readFile(
  new URL("../packages/weave/examples/killbill-orchestration/sources/core.json", import.meta.url),
);
assert.equal(sha256Hex(raw), task.contract.source_bundle_sha256);
const source = JSON.parse(raw).files.find((f) =>
  f.path.endsWith("/IncompletePaymentTransactionTask.java"),
).content;
assert.equal(sha256Hex(source), task.reference_sha256);
const base = await readFile(new URL("./fixtures/JanitorProbe.java", import.meta.url), "utf8");
assert.equal(sha256Hex(base), task.oracle.driver_sha256);
const money = await readFile(new URL("./fixtures/JanitorMoneyProbe.java", import.meta.url), "utf8");
const change = (from, to) => {
  assert.equal(source.split(from).length, 2, `unique source anchor required: ${from}`);
  return source.replace(from, to);
};
const variants = {
  upstream_reference: source,
  authored_equivalent: change(
    "paymentTransaction.getProcessedAmount(),",
    "(paymentTransaction.getProcessedAmount()),",
  ),
  requested_amount_default: change(
    "paymentTransaction.getProcessedAmount(),",
    "paymentTransaction.getAmount(),",
  ),
  requested_currency_default: change(
    "paymentTransaction.getProcessedCurrency(),",
    "paymentTransaction.getCurrency(),",
  ),
};
const names = [
  "both_absent_existing",
  "amount_absent",
  "currency_absent",
  "explicit_override",
  "zero_is_present",
  "success_with_zero_default",
  "pending_same_no_write",
];
const outputs = [
  ["3", "USD"],
  ["3", "EUR"],
  ["4", "USD"],
  ["4", "EUR"],
  ["0", "EUR"],
  ["0", "EUR"],
  ["3", "USD"],
];
const inputs = [
  [null, null],
  [null, "EUR"],
  ["4.00", null],
  ["4.00", "EUR"],
  ["0", "EUR"],
  [null, null],
  ["9.00", "EUR"],
];
const caseOrder = [...task.contract.observation.cases, ...names];
const expected = { ...task.contract.expected };
for (const [i, name] of names.entries())
  expected[name] = {
    payment_state: name === "pending_same_no_write" ? "AUTH_PENDING" : "AUTH_SUCCESS",
    transaction_status: name === "pending_same_no_write" ? "PENDING" : "SUCCESS",
    processed_amount: outputs[i][0],
    processed_currency: outputs[i][1],
    updates: name === "pending_same_no_write" ? 0 : 1,
    changed: name !== "pending_same_no_write",
  };
const expectedFailures = {
  upstream_reference: [],
  authored_equivalent: [],
  requested_amount_default: ["both_absent_existing", "amount_absent", "success_with_zero_default"],
  requested_currency_default: ["both_absent_existing", "currency_absent"],
};
const frozen = {
  format: "janitor-money-author-probe-input-v1",
  old_task_digest: task.digest,
  old_driver_sha256: sha256Hex(base),
  money_driver_sha256: sha256Hex(money),
  source_bundle_sha256: sha256Hex(raw),
  source_revision: task.contract.source_revision,
  variants: Object.fromEntries(Object.entries(variants).map(([name, s]) => [name, sha256Hex(s)])),
  expected,
  case_order: caseOrder,
  plugin_inputs: inputs,
  expected_failures: expectedFailures,
  environment: task.environment,
  script_sha256: sha256Hex(await readFile(new URL(import.meta.url))),
  qualification: "not_qualified",
};
await put(
  join(root, "frozen-input.json"),
  `${canonicalJson({ ...frozen, digest: canonicalJsonDigest(frozen) })}\n`,
);
const jars = Object.keys(task.environment.binaries).map((n) =>
  join(oldRoot, "control/dependencies", n),
);
const jdk = task.environment.java_home;
const observations = [];
const good = (p) => p?.exitCode === 0 && p.signal === null && !p.timedOut && !p.outputLimitExceeded;
for (const [name, candidate] of Object.entries(variants)) {
  const dir = join(root, name),
    classes = join(dir, "classes");
  await put(
    join(classes, "mockito-extensions/org.mockito.plugins.MockMaker"),
    "mock-maker-subclass\n",
  );
  await put(join(dir, "IncompletePaymentTransactionTask.java"), candidate);
  await put(join(dir, "JanitorProbe.java"), base);
  await put(join(dir, "JanitorMoneyProbe.java"), money);
  const runner = new StrictProcessRunner();
  const common = {
    cwd: dir,
    readableRoots: [...jars, jdk],
    writableRoot: classes,
    timeoutMs: 30000,
    maxOutputBytes: 256 * 1024,
  };
  let compile = null,
    execution = null,
    invalid = null,
    rows = [],
    checks = [];
  try {
    compile = await runner.run({
      ...common,
      executable: join(jdk, "bin/javac"),
      args: [
        "-proc:none",
        "--release",
        "11",
        "-classpath",
        jars.join(delimiter),
        "-d",
        classes,
        ...[
          "IncompletePaymentTransactionTask.java",
          "JanitorProbe.java",
          "JanitorMoneyProbe.java",
        ].map((n) => join(dir, n)),
      ],
    });
    assert.ok(good(compile), "compile/environment invalid");
    execution = await runner.run({
      ...common,
      executable: join(jdk, "bin/java"),
      args: [
        "-Xmx256m",
        "-XX:-UsePerfData",
        "-classpath",
        [classes, ...jars].join(delimiter),
        "org.killbill.billing.payment.core.janitor.JanitorMoneyProbe",
        classes,
      ],
    });
    assert.ok(good(execution), "execution/environment invalid");
    const lines = execution.stdout.trim().split("\n");
    const [begin, nonce, extra] = lines[0].split("\t");
    assert.ok(begin === "BEGIN" && !extra && /^[0-9a-f-]{36}$/.test(nonce));
    assert.equal(lines.at(-1), `END\t${nonce}`);
    rows = lines
      .slice(1, -1)
      .filter((l) => l.startsWith(`${nonce}\t`))
      .map((l) => JSON.parse(l.slice(nonce.length + 1)));
    assert.deepEqual(
      rows.map((r) => r.scenario),
      caseOrder,
    );
    checks = rows.map((r) => {
      assert.equal(r.old_snapshot_unchanged, true);
      assert.equal(r.lock_held, false);
      assert.equal(r.acquired, r.released);
      assert.equal(r.transaction_id, "00000000-0000-0000-0000-000000000003");
      assert.ok(Array.isArray(r.trace));
      assert.equal(r.trace.filter((s) => s === "acquired").length, r.acquired);
      assert.equal(r.trace.filter((s) => s === "released").length, r.released);
      assert.equal(r.trace.filter((s) => s.startsWith("write:")).length, r.updates);
      const moneyIndex = names.indexOf(r.scenario);
      if (moneyIndex >= 0) {
        const zero = r.scenario === "success_with_zero_default";
        assert.equal(r.requested_amount, "10.00");
        assert.equal(r.requested_currency, "EUR");
        assert.equal(r.prior_amount, zero ? "0" : "3.00");
        assert.equal(r.prior_currency, zero ? "EUR" : "USD");
        assert.equal(r.prior_status, zero ? "UNKNOWN" : "PENDING");
        assert.equal(r.acquired, 1);
        assert.deepEqual([r.plugin_amount, r.plugin_currency], inputs[moneyIndex]);
      }
      if (r.scenario === "concurrent_capture") {
        const prior = r.trace.indexOf("other-operation:AUTH_SUCCESS->CAPTURE_SUCCESS");
        assert.ok(prior >= 0 && prior < r.trace.indexOf("acquired"));
      }
      const differences = Object.entries(expected[r.scenario])
        .filter(([field, value]) =>
          field === "processed_amount"
            ? !new RegExp(`^${String(value).split(".")[0]}(?:\\.0+)?$`).test(r[field])
            : r[field] !== value,
        )
        .map(([field, value]) => ({ field, expected: value, observed: r[field] }));
      return { scenario: r.scenario, verdict: differences.length ? "fail" : "pass", differences };
    });
  } catch (error) {
    invalid = error.message;
  }
  const failed = checks.filter((c) => c.verdict === "fail").map((c) => c.scenario);
  const expectationMatched =
    !invalid && canonicalJsonDigest(failed) === canonicalJsonDigest(expectedFailures[name]);
  const evidence = {
    name,
    source_sha256: sha256Hex(candidate),
    compile,
    execution,
    rows,
    checks,
    invalid,
    expected_failure_pattern_matched: expectationMatched,
  };
  observations.push(evidence);
  await put(join(dir, "evidence.json"), `${canonicalJson(evidence)}\n`);
  console.log(JSON.stringify({ name, invalid, failed, expectationMatched }));
  if (invalid || !expectationMatched) break;
}
const report = {
  format: "janitor-money-author-probe-v1",
  root,
  frozen_input: frozen,
  observations,
  author_calibration_passed:
    observations.length === 4 && observations.every((o) => o.expected_failure_pattern_matched),
  independent_calibration: "pending",
  agent_execution: "not_observed",
  models_run: 0,
  qualification: "not_qualified",
};
const digest = canonicalJsonDigest(report);
await put(join(root, "report.json"), `${canonicalJson({ ...report, digest })}\n`);
console.log(
  JSON.stringify({
    root,
    digest,
    author_calibration_passed: report.author_calibration_passed,
    models_run: 0,
  }),
);
if (!report.author_calibration_passed) process.exitCode = 1;
