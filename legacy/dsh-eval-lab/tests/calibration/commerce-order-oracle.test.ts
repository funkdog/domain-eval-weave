import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { calibrateCommercePackDetailed } from "../../src/oracle/commerce-calibration.js";
import { COMMERCE_BEHAVIORS, CommerceOrderOracle } from "../../src/oracle/commerce-order.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v1", import.meta.url),
);

test("commerce red and Gold calibrate in opposite directions", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/commerce-oracle-`);
  try {
    const oracle = new CommerceOrderOracle({
      runner: new StrictProcessRunner(),
      oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
    });
    const [red, gold] = await Promise.all([
      oracle.evaluateDirectory(`${packRoot}/base`, 1729, `${scratch}/red`),
      oracle.evaluateDirectory(`${packRoot}/calibration/gold-equivalent`, 1729, `${scratch}/gold`),
    ]);
    assert.deepEqual(
      COMMERCE_BEHAVIORS.filter((behavior) => red[behavior] !== "pass"),
      [...COMMERCE_BEHAVIORS],
    );
    assert.deepEqual(
      COMMERCE_BEHAVIORS.filter((behavior) => gold[behavior] !== "pass"),
      [],
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("commerce Gold, red, and five mutants calibrate to exact vectors", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/commerce-calibration-`);
  try {
    const oracle = new CommerceOrderOracle({
      runner: new StrictProcessRunner(),
      oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
    });
    const evidence = await calibrateCommercePackDetailed({
      oracle,
      packRoot,
      scratchRoot: scratch,
      seed: 1729,
    });
    const failures = (candidate: keyof typeof evidence.vectors) =>
      COMMERCE_BEHAVIORS.filter((behavior) => evidence.vectors[candidate][behavior] !== "pass");
    assert.deepEqual(failures("red"), [...COMMERCE_BEHAVIORS]);
    assert.deepEqual(failures("gold"), []);
    assert.deepEqual(failures("mutant-shipped-cancel"), ["shipped_order_requires_after_sales"]);
    assert.deepEqual(failures("mutant-overrefund"), ["paid_unshipped_creates_paid_amount_refund"]);
    assert.deepEqual(failures("mutant-double-effects"), [
      "inventory_release_is_exactly_once",
      "restart_recovery_preserves_idempotency_and_audit",
    ]);
    assert.deepEqual(failures("mutant-coupon-always-restored"), [
      "coupon_restore_requires_current_eligibility",
    ]);
    assert.deepEqual(failures("mutant-no-ownership-or-persistence"), [
      "customer_ownership_is_enforced",
      "restart_recovery_preserves_idempotency_and_audit",
    ]);
    assert.deepEqual(evidence.vectors["gold-repeat"], evidence.vectors.gold);
    assert.deepEqual(evidence.vectors["gold-next-seed"], evidence.vectors.gold);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
