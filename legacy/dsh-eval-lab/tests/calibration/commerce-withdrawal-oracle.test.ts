import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { calibrateCommercePackDetailed } from "../../src/oracle/commerce-calibration-v2.js";
import { COMMERCE_BEHAVIORS, CommerceOrderOracle } from "../../src/oracle/commerce-order-v2.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v2", import.meta.url),
);

const expectedFailures = {
  red: COMMERCE_BEHAVIORS,
  "mutant-handed-off-cancel": ["handed_off_order_requires_after_sales"],
  "mutant-overrefund-or-currency": [
    "paid_unstarted_creates_paid_amount_refund",
    "withdrawal_completion_precedes_cancellation",
    "restart_recovery_preserves_handoffs_and_audit",
    "refund_preserves_paid_amount_currency_and_units",
    "expired_replay_reconciles_or_fails_closed",
  ],
  "mutant-premature-cancel": [
    "active_fulfillment_enters_pending_withdrawal",
    "withdrawal_completion_precedes_cancellation",
    "withdrawal_rejection_preserves_order_and_effects",
    "withdrawal_failure_is_recoverable_without_effects",
    "inventory_compensation_is_exactly_once",
    "restart_recovery_preserves_handoffs_and_audit",
    "audit_and_retention_policy_are_complete",
  ],
  "mutant-withdrawal-rejection-effects": ["withdrawal_rejection_preserves_order_and_effects"],
  "mutant-withdrawal-failure-effects": ["withdrawal_failure_is_recoverable_without_effects"],
  "mutant-double-effects": [
    "inventory_compensation_is_exactly_once",
    "request_replay_and_conflict_are_idempotent",
    "expired_replay_reconciles_or_fails_closed",
  ],
  "mutant-coupon-always-restored": ["coupon_restore_requires_current_eligibility"],
  "mutant-no-ownership": ["customer_ownership_is_enforced"],
  "mutant-no-persistence": [
    "withdrawal_failure_is_recoverable_without_effects",
    "restart_recovery_preserves_handoffs_and_audit",
    "expired_replay_reconciles_or_fails_closed",
  ],
  "mutant-expired-replay-fresh": ["expired_replay_reconciles_or_fails_closed"],
  "mutant-sparse-audit": [
    "withdrawal_failure_is_recoverable_without_effects",
    "restart_recovery_preserves_handoffs_and_audit",
    "expired_replay_reconciles_or_fails_closed",
    "audit_and_retention_policy_are_complete",
  ],
} as const;

test("commerce withdrawal Gold, red, and eleven mutants calibrate to exact vectors", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/commerce-withdrawal-calibration-`);
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
    for (const [candidate, expected] of Object.entries(expectedFailures)) {
      assert.deepEqual(failures(candidate as keyof typeof evidence.vectors), expected);
    }
    assert.deepEqual(failures("gold"), []);
    assert.deepEqual(evidence.vectors["gold-repeat"], evidence.vectors.gold);
    assert.deepEqual(evidence.vectors["gold-next-seed"], evidence.vectors.gold);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
