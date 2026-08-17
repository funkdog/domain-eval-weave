import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { calibrateLedgerPack } from "../../src/oracle/calibration.js";
import { LedgerOracle } from "../../src/oracle/ledger.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-ledger-v1", import.meta.url),
);

test("red/gold and three targeted mutants calibrate in the intended directions", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/oracle-calibration-`);
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
  });

  try {
    const result = await calibrateLedgerPack({
      oracle,
      packRoot,
      scratchRoot: scratch,
      seed: 1729,
    });
    assert.equal(result.ready, true);
    assert.equal(
      result.candidates.gold.every((status) => status === "pass"),
      true,
    );
    assert.deepEqual(result.candidates.no_lock_failures, ["no_oversubscription_concurrent"]);
    assert.deepEqual(result.candidates.no_persistence_failures, ["restart_recovery"]);
    assert.deepEqual(result.candidates.corrupt_resets_failures, ["corrupt_state_fail_closed"]);
    assert.equal(result.repeatable, true);
    assert.equal(result.seed_stable, true);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("the seeded Oracle produces byte-identical vectors for the same candidate and seed", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/oracle-repeat-`);
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
  });
  try {
    const first = await oracle.evaluateDirectory(
      `${packRoot}/calibration/gold-equivalent`,
      42,
      `${scratch}/a`,
    );
    const second = await oracle.evaluateDirectory(
      `${packRoot}/calibration/gold-equivalent`,
      42,
      `${scratch}/b`,
    );
    assert.deepEqual(second, first);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Oracle rejects candidates that accept invalid integers or unknown state versions", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/oracle-invalid-contract-`);
  const invalidIntegers = `${scratch}/invalid-integers`;
  const unknownVersion = `${scratch}/unknown-version`;
  const gold = `${packRoot}/calibration/gold-equivalent`;
  await Promise.all([
    cp(gold, invalidIntegers, { recursive: true }),
    cp(gold, unknownVersion, { recursive: true }),
  ]);
  const invalidLedger = `${invalidIntegers}/src/ledger.ts`;
  const versionLedger = `${unknownVersion}/src/ledger.ts`;
  await writeFile(
    invalidLedger,
    (await readFile(invalidLedger, "utf8"))
      .replace('positive(capacity, "capacity");', "")
      .replace('positive(request.units, "units");', ""),
  );
  await writeFile(
    versionLedger,
    (await readFile(versionLedger, "utf8")).replace("value.version !== 1 || ", ""),
  );
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
  });

  try {
    const invalid = await oracle.evaluateDirectory(invalidIntegers, 42, `${scratch}/checks-a`);
    const version = await oracle.evaluateDirectory(unknownVersion, 42, `${scratch}/checks-b`);
    assert.equal(invalid.basic_reservation, "fail");
    assert.equal(version.corrupt_state_fail_closed, "fail");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("candidate code cannot read the hidden Oracle source during evaluation", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/oracle-hidden-`);
  const candidate = `${scratch}/candidate`;
  const oraclePath = `${packRoot}/oracle/runner.mjs`;
  await cp(`${packRoot}/calibration/gold-equivalent`, candidate, { recursive: true });
  const ledgerPath = `${candidate}/src/ledger.ts`;
  const ledger = await readFile(ledgerPath, "utf8");
  await writeFile(
    ledgerPath,
    [
      'import { readFileSync } from "node:fs";',
      'import { execFileSync } from "node:child_process";',
      "let hiddenOracleWasReadable = false;",
      `try { readFileSync(${JSON.stringify(oraclePath)}); hiddenOracleWasReadable = true; } catch {}`,
      'hiddenOracleWasReadable ||= process.execArgv.join(" ").includes("basic_reservation");',
      'hiddenOracleWasReadable ||= String(process._eval ?? "").includes("basic_reservation");',
      'try { hiddenOracleWasReadable ||= execFileSync("/bin/ps", ["-p", String(process.ppid), "-o", "command="]).toString().includes("basic_reservation"); } catch {}',
      ledger.replace(
        "static async open(file, capacity) {",
        'static async open(file, capacity) { if (hiddenOracleWasReadable) throw new Error("oracle leaked");',
      ),
    ].join("\n"),
  );
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: oraclePath,
  });
  try {
    const result = await oracle.evaluateDirectory(candidate, 42, `${scratch}/checks`);
    assert.equal(
      Object.values(result).every((status) => status === "pass"),
      true,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Oracle self-failure is classified as measurement error, not candidate fail", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/oracle-self-error-`);
  const brokenOracle = `${scratch}/broken-oracle.mjs`;
  await writeFile(brokenOracle, 'throw new Error("synthetic Oracle failure");\n');
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: brokenOracle,
  });
  try {
    const result = await oracle.evaluateDirectory(
      `${packRoot}/calibration/gold-equivalent`,
      42,
      `${scratch}/checks`,
    );
    assert.equal(
      Object.values(result).every((status) => status === "error"),
      true,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Oracle self-hang is an infrastructure error rather than a Candidate behavior failure", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/oracle-self-hang-`);
  const brokenOracle = `${scratch}/hung-oracle.mjs`;
  await writeFile(brokenOracle, "await new Promise(() => {});\n");
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: brokenOracle,
    timeoutMsPerBehavior: 100,
  });
  try {
    const result = await oracle.evaluateDirectory(
      `${packRoot}/calibration/gold-equivalent`,
      42,
      `${scratch}/checks`,
    );
    assert.equal(
      Object.values(result).every((status) => status === "error"),
      true,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("one hung Candidate behavior times out locally without poisoning the other seven", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/oracle-one-hang-`);
  const candidate = `${scratch}/candidate`;
  await cp(`${packRoot}/calibration/gold-equivalent`, candidate, { recursive: true });
  const ledgerPath = `${candidate}/src/ledger.ts`;
  await writeFile(
    ledgerPath,
    (await readFile(ledgerPath, "utf8")).replace(
      "static async open(file, capacity) {",
      "static async open(file, capacity) { if (capacity === 0) await new Promise(() => {});",
    ),
  );
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
    timeoutMsPerBehavior: 500,
  });
  try {
    const result = await oracle.evaluateDirectory(candidate, 42, `${scratch}/checks`);
    assert.equal(result.basic_reservation, "fail");
    assert.equal(
      Object.entries(result)
        .filter(([name]) => name !== "basic_reservation")
        .every(([, status]) => status === "pass"),
      true,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
