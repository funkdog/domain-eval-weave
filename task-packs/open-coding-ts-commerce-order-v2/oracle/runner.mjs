import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

function argumentsMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || result.has(name)) {
      throw new Error("invalid args");
    }
    result.set(name, value);
  }
  return result;
}

const DRIVER_SOURCE = String.raw`
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
process.execArgv.splice(0, process.execArgv.length);
if ("_eval" in process) delete process._eval;
const candidate = process.argv[1];
let OrderService;
try {
  ({ OrderService } = await import(pathToFileURL(candidate + "/src/order-service.ts").href));
  if (typeof OrderService?.open !== "function") throw new Error("invalid candidate API");
} catch {
  process.exit(1);
}
let service;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const active = new Set();
for await (const line of input) {
  const pending = (async () => {
    let request;
    try {
      request = JSON.parse(line);
      let value;
      switch (request.operation) {
        case "open":
          service = await OrderService.open(request.file);
          value = true;
          break;
        case "create":
          value = await service.createOrder(request.order);
          break;
        case "cancel":
          value = await service.cancelOrder(request.input);
          break;
        case "withdrawal":
          value = await service.resolveWithdrawal(request.input);
          break;
        case "refunded":
          value = await service.markRefunded(request.orderId);
          break;
        case "get":
          value = await service.getOrder(request.orderId);
          break;
        case "audit":
          value = await service.getAuditEvents(request.orderId);
          break;
        case "retention":
          value = await service.getRetentionPolicy();
          break;
        default:
          throw new Error("unknown operation");
      }
      process.stdout.write(JSON.stringify({ id: request.id, ok: true, value }) + "\n");
    } catch {
      process.stdout.write(JSON.stringify({ id: request?.id, ok: false }) + "\n");
    }
  })();
  active.add(pending);
  void pending.finally(() => active.delete(pending));
}
await Promise.allSettled([...active]);
`;

class CandidateDriver {
  #child;
  #nextId = 0;
  #pending = new Map();
  #closed;
  #closing;

  constructor(candidate) {
    this.#child = spawn(
      process.execPath,
      ["--input-type=module", "-e", DRIVER_SOURCE, "--", candidate],
      { cwd: candidate, env: process.env, stdio: ["pipe", "pipe", "ignore"] },
    );
    this.#closed = new Promise((resolveClosed) => this.#child.once("close", resolveClosed));
    createInterface({ input: this.#child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        this.#fail(new Error("candidate driver protocol failed"));
        return;
      }
      const pending = this.#pending.get(response.id);
      if (pending === undefined) return;
      this.#pending.delete(response.id);
      if (response.ok === true) pending.resolve(response.value);
      else pending.reject(new Error("candidate operation failed"));
    });
    this.#child.once("error", (error) => this.#fail(error));
    this.#child.once("close", () => this.#fail(new Error("candidate driver exited")));
  }

  #fail(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  call(operation, fields = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolveCall, rejectCall) => {
      this.#pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.#child.stdin.write(`${JSON.stringify({ id, operation, ...fields })}\n`, (error) => {
        if (error) {
          this.#pending.delete(id);
          rejectCall(error);
        }
      });
    });
  }

  async close() {
    this.#closing ??= (async () => {
      this.#child.stdin.end();
      const timer = setTimeout(() => this.#child.kill("SIGKILL"), 500);
      try {
        await this.#closed;
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.#closing;
  }
}

const activeDrivers = new Set();
async function withDriver(candidate, operation) {
  const driver = new CandidateDriver(candidate);
  activeDrivers.add(driver);
  try {
    return await operation(driver);
  } finally {
    await driver.close();
    activeDrivers.delete(driver);
  }
}

async function rejects(operation) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

const args = argumentsMap(process.argv.slice(2));
process.execArgv.splice(0, process.execArgv.length);
if ("_eval" in process) delete process._eval;
const candidate = resolve(args.get("--candidate"));
const scratch = resolve(args.get("--scratch"));
const seed = Number(args.get("--seed"));
const selectedBehavior = args.get("--behavior");
const timeoutMs = Number(args.get("--timeout-ms"));
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("invalid seed");
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout");
const opaque = (label) =>
  `commerce-${createHash("sha256").update(`${seed}:${label}`).digest("hex").slice(0, 16)}`;
const stateFile = resolve(scratch, "orders.json");
const time = "2026-08-21T00:00:00.000Z";
const validCouponExpiry = "2026-08-23T00:00:00.000Z";
const expiredCouponExpiry = "2026-08-20T00:00:00.000Z";

function order(label, overrides = {}) {
  return {
    id: opaque(`order-${label}`),
    customerId: opaque(`customer-${label}`),
    status: "pending_payment",
    fulfillmentState: "not_started",
    withdrawalState: "none",
    listAmount: 10_000,
    paidAmount: 0,
    currency: "USD",
    inventoryReserved: false,
    refundStatus: "none",
    refundAmount: 0,
    version: 1,
    ...overrides,
  };
}

function cancellation(target, label, overrides = {}) {
  return {
    orderId: target.id,
    customerId: target.customerId,
    requestId: opaque(`request-${label}`),
    now: time,
    ...overrides,
  };
}

function withdrawal(target, label, outcome, overrides = {}) {
  return {
    orderId: target.id,
    requestId: opaque(`withdrawal-${label}`),
    providerRef: opaque(`provider-${label}`),
    outcome,
    now: "2026-08-22T00:01:00.000Z",
    ...overrides,
  };
}

const effectTypes = new Set([
  "order_cancelled",
  "refund_requested",
  "inventory_compensated",
  "coupon_restored",
]);

function effectCount(audit) {
  return audit.filter((event) => effectTypes.has(event.type)).length;
}

const checks = {
  async unpaid_cancel_has_no_refund() {
    await withDriver(candidate, async (driver) => {
      const target = order("unpaid", { inventoryReserved: true });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const result = await driver.call("cancel", { input: cancellation(target, "unpaid") });
      assert.equal(result.order.status, "cancelled");
      assert.equal(result.order.refundStatus, "none");
      assert.equal(result.order.refundAmount, 0);
      assert.equal(result.refundRequested, false);
    });
  },

  async paid_unstarted_creates_paid_amount_refund() {
    await withDriver(candidate, async (driver) => {
      const target = order("paid", { status: "paid", paidAmount: 8_000 });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const result = await driver.call("cancel", { input: cancellation(target, "paid") });
      assert.equal(result.order.status, "cancelled");
      assert.equal(result.order.refundStatus, "pending");
      assert.equal(result.order.refundAmount, 8_000);
      assert.equal(result.order.currency, "USD");
      assert.equal(result.refundRequested, true);
    });
  },

  async handed_off_order_requires_after_sales() {
    await withDriver(candidate, async (driver) => {
      const target = order("handed-off", {
        status: "paid",
        paidAmount: 8_000,
        fulfillmentState: "handed_off",
      });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      assert.equal(
        await rejects(() =>
          driver.call("cancel", { input: cancellation(target, "handed-off") }),
        ),
        true,
      );
      assert.deepEqual(await driver.call("get", { orderId: target.id }), target);
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].type, "command_rejected");
      assert.equal(audit[0].reason, "carrier_handoff_committed");
      assert.equal(effectCount(audit), 0);
    });
  },

  async cancellation_and_refund_states_are_separate() {
    await withDriver(candidate, async (driver) => {
      const target = order("separate", { status: "paid", paidAmount: 8_000 });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const result = await driver.call("cancel", { input: cancellation(target, "separate") });
      assert.equal(result.order.refundStatus, "pending");
      const refunded = await driver.call("refunded", { orderId: target.id });
      assert.equal(refunded.status, "cancelled");
      assert.equal(refunded.refundStatus, "refunded");
      assert.deepEqual(
        (await driver.call("audit", { orderId: target.id })).map((event) => event.type),
        ["order_cancelled", "refund_requested", "refund_completed"],
      );
    });
  },

  async active_fulfillment_enters_pending_withdrawal() {
    await withDriver(candidate, async (driver) => {
      const target = order("active", {
        status: "paid",
        paidAmount: 8_000,
        fulfillmentState: "active",
        inventoryReserved: true,
      });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const value = await driver.call("cancel", { input: cancellation(target, "active") });
      assert.equal(value.order.status, "paid");
      assert.equal(value.order.withdrawalState, "pending");
      assert.equal(value.customerStatus, "cancellation_pending_fulfilment");
      assert.equal(value.refundRequested, false);
      assert.equal(value.inventoryReleased, false);
      assert.equal(value.couponRestored, false);
      const audit = await driver.call("audit", { orderId: target.id });
      assert.deepEqual(
        audit.map((event) => event.type),
        ["cancellation_requested", "withdrawal_requested"],
      );
      assert.equal(effectCount(audit), 0);
    });
  },

  async withdrawal_completion_precedes_cancellation() {
    await withDriver(candidate, async (driver) => {
      const target = order("complete", {
        status: "paid",
        paidAmount: 8_000,
        fulfillmentState: "active",
        inventoryReserved: true,
      });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const pending = await driver.call("cancel", {
        input: cancellation(target, "complete"),
      });
      assert.equal(pending.order.status, "paid");
      const completed = await driver.call("withdrawal", {
        input: withdrawal(target, "complete", "completed"),
      });
      assert.equal(completed.order.status, "cancelled");
      assert.equal(completed.order.withdrawalState, "completed");
      assert.equal(completed.order.refundStatus, "pending");
      assert.equal(completed.order.refundAmount, 8_000);
    });
  },

  async withdrawal_rejection_preserves_order_and_effects() {
    await withDriver(candidate, async (driver) => {
      const target = order("rejected", {
        status: "paid",
        paidAmount: 8_000,
        fulfillmentState: "active",
        inventoryReserved: true,
        coupon: { id: opaque("rejected-coupon"), expiresAt: validCouponExpiry, restored: false },
      });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      await driver.call("cancel", { input: cancellation(target, "rejected") });
      const rejected = await driver.call("withdrawal", {
        input: withdrawal(target, "rejected", "rejected"),
      });
      assert.equal(rejected.order.status, "paid");
      assert.equal(rejected.order.withdrawalState, "rejected");
      assert.equal(rejected.customerStatus, "cancellation_rejected");
      assert.equal(rejected.order.inventoryReserved, true);
      assert.equal(rejected.order.coupon.restored, false);
      assert.equal(rejected.order.refundStatus, "none");
      assert.equal(effectCount(await driver.call("audit", { orderId: target.id })), 0);
    });
  },

  async withdrawal_failure_is_recoverable_without_effects() {
    const target = order("failed", {
      status: "paid",
      paidAmount: 8_000,
      fulfillmentState: "active",
      inventoryReserved: true,
    });
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      await driver.call("cancel", { input: cancellation(target, "failed") });
      const failed = await driver.call("withdrawal", {
        input: withdrawal(target, "failed", "failed"),
      });
      assert.equal(failed.order.status, "paid");
      assert.equal(failed.order.withdrawalState, "failed");
      assert.equal(failed.customerStatus, "cancellation_failed");
      assert.equal(effectCount(await driver.call("audit", { orderId: target.id })), 0);
    });
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      assert.equal((await driver.call("get", { orderId: target.id })).withdrawalState, "failed");
      await driver.call("cancel", { input: cancellation(target, "failed-retry") });
      const completed = await driver.call("withdrawal", {
        input: withdrawal(target, "failed-retry", "completed"),
      });
      assert.equal(completed.order.status, "cancelled");
      assert.equal(completed.order.withdrawalState, "completed");
    });
  },

  async inventory_compensation_is_exactly_once() {
    await withDriver(candidate, async (driver) => {
      const target = order("inventory", {
        status: "paid",
        paidAmount: 8_000,
        fulfillmentState: "active",
        inventoryReserved: true,
      });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      await driver.call("cancel", { input: cancellation(target, "inventory") });
      const input = withdrawal(target, "inventory", "completed");
      const [left, right] = await Promise.all([
        driver.call("withdrawal", { input }),
        driver.call("withdrawal", { input }),
      ]);
      assert.deepEqual(left, right);
      assert.equal((await driver.call("get", { orderId: target.id })).inventoryReserved, false);
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.filter((event) => event.type === "inventory_compensated").length, 1);
      assert.deepEqual(await driver.call("withdrawal", { input }), left);
    });
  },

  async coupon_restore_requires_current_eligibility() {
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      const valid = order("coupon-valid", {
        coupon: { id: opaque("coupon-valid"), expiresAt: validCouponExpiry, restored: false },
      });
      const expired = order("coupon-expired", {
        coupon: { id: opaque("coupon-expired"), expiresAt: expiredCouponExpiry, restored: false },
      });
      await driver.call("create", { order: valid });
      await driver.call("create", { order: expired });
      assert.equal(
        (await driver.call("cancel", { input: cancellation(valid, "coupon-valid") })).couponRestored,
        true,
      );
      assert.equal(
        (await driver.call("cancel", { input: cancellation(expired, "coupon-expired") }))
          .couponRestored,
        false,
      );
      assert.equal((await driver.call("get", { orderId: valid.id })).coupon.restored, true);
      assert.equal((await driver.call("get", { orderId: expired.id })).coupon.restored, false);
      assert.equal(
        (await driver.call("audit", { orderId: expired.id })).some(
          (event) => event.type === "coupon_restored",
        ),
        false,
      );
    });
  },

  async customer_ownership_is_enforced() {
    await withDriver(candidate, async (driver) => {
      const target = order("ownership", { status: "paid", paidAmount: 8_000 });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      assert.equal(
        await rejects(() =>
          driver.call("cancel", {
            input: cancellation(target, "ownership-wrong", {
              customerId: opaque("other-customer"),
            }),
          }),
        ),
        true,
      );
      assert.deepEqual(await driver.call("get", { orderId: target.id }), target);
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].type, "command_rejected");
      assert.equal(effectCount(audit), 0);
    });
  },

  async request_replay_and_conflict_are_idempotent() {
    await withDriver(candidate, async (driver) => {
      const target = order("idempotency", { inventoryReserved: true });
      const input = cancellation(target, "idempotency");
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const [left, right] = await Promise.all([
        driver.call("cancel", { input }),
        driver.call("cancel", { input }),
      ]);
      assert.deepEqual(left, right);
      assert.equal(
        await rejects(() =>
          driver.call("cancel", {
            input: { ...input, customerId: opaque("idempotency-other") },
          }),
        ),
        true,
      );
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.filter((event) => event.type === "order_cancelled").length, 1);
      assert.equal(audit.filter((event) => event.type === "inventory_compensated").length, 1);
      assert.equal(audit.filter((event) => event.type === "idempotency_conflict").length, 1);
    });
  },

  async restart_recovery_preserves_handoffs_and_audit() {
    const target = order("restart", {
      status: "paid",
      paidAmount: 8_000,
      fulfillmentState: "active",
      inventoryReserved: true,
      coupon: { id: opaque("restart-coupon"), expiresAt: validCouponExpiry, restored: false },
    });
    const cancelInput = cancellation(target, "restart");
    const withdrawalInput = withdrawal(target, "restart", "completed");
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const pending = await driver.call("cancel", { input: cancelInput });
      assert.equal(pending.order.withdrawalState, "pending");
    });
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      const pending = await driver.call("get", { orderId: target.id });
      assert.equal(pending.status, "paid");
      assert.equal(pending.withdrawalState, "pending");
      await driver.call("withdrawal", { input: withdrawalInput });
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.filter((event) => event.type === "order_cancelled").length, 1);
      assert.equal(audit.filter((event) => event.type === "withdrawal_requested").length, 1);
      assert.equal(audit.filter((event) => event.type === "withdrawal_completed").length, 1);
      assert.equal(audit.filter((event) => event.type === "inventory_compensated").length, 1);
      assert.equal(audit.filter((event) => event.type === "coupon_restored").length, 1);
      assert.equal(audit.filter((event) => event.type === "refund_requested").length, 1);
      await driver.call("refunded", { orderId: target.id });
    });
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      assert.equal((await driver.call("get", { orderId: target.id })).refundStatus, "refunded");
      assert.equal(
        (await driver.call("audit", { orderId: target.id })).filter(
          (event) => event.type === "refund_completed",
        ).length,
        1,
      );
    });
    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(persisted.schemaVersion, 2);
  },

  async refund_preserves_paid_amount_currency_and_units() {
    await withDriver(candidate, async (driver) => {
      const target = order("money", {
        status: "paid",
        listAmount: 10_000,
        paidAmount: 8_000,
        currency: "EUR",
      });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const value = await driver.call("cancel", { input: cancellation(target, "money") });
      assert.equal(value.order.refundAmount, 8_000);
      assert.equal(value.order.currency, "EUR");
      const refund = (await driver.call("audit", { orderId: target.id })).find(
        (event) => event.type === "refund_requested",
      );
      assert.equal(refund.amount, 8_000);
      assert.equal(refund.currency, "EUR");
    });
  },

  async expired_replay_reconciles_or_fails_closed() {
    const target = order("expired", { status: "paid", paidAmount: 8_000, inventoryReserved: true });
    const originalInput = cancellation(target, "expired", { now: "2026-01-01T00:00:00.000Z" });
    let original;
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      original = await driver.call("cancel", { input: originalInput });
    });
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      const delayed = await driver.call("cancel", {
        input: { ...originalInput, now: "2026-04-02T00:00:00.000Z" },
      });
      assert.deepEqual(delayed, original);
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.filter((event) => event.type === "inventory_compensated").length, 1);
      assert.equal(audit.filter((event) => event.type === "refund_requested").length, 1);
    });
  },

  async audit_and_retention_policy_are_complete() {
    await withDriver(candidate, async (driver) => {
      const target = order("audit", {
        status: "paid",
        paidAmount: 8_000,
        fulfillmentState: "active",
        inventoryReserved: true,
      });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      await driver.call("cancel", { input: cancellation(target, "audit") });
      await driver.call("withdrawal", { input: withdrawal(target, "audit", "completed") });
      const policy = await driver.call("retention");
      assert.deepEqual(policy, {
        idempotencyDays: 90,
        financialAndOrderDays: 2555,
        securityConflictDays: 365,
        deliveryDiagnosticDays: 90,
      });
      const audit = await driver.call("audit", { orderId: target.id });
      assert.ok(audit.length >= 6);
      for (const event of audit) {
        for (const key of [
          "sequence",
          "orderId",
          "requestId",
          "type",
          "operation",
          "actorId",
          "actorScope",
          "outcome",
          "reason",
          "beforeVersion",
          "afterVersion",
          "policyVersion",
          "correlationId",
          "causationId",
          "occurredAt",
        ]) {
          assert.ok(key in event, `missing audit field ${key}`);
        }
        assert.equal(event.policyVersion, "commerce-order-cancellation-v2");
      }
    });
  },
};

const operation = checks[selectedBehavior];
if (operation === undefined) throw new Error("unknown behavior");
await mkdir(scratch, { recursive: true });
let status = "pass";
let timeout;
try {
  await Promise.race([
    operation(),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("candidate behavior timeout")), timeoutMs);
    }),
  ]);
} catch {
  status = "fail";
} finally {
  clearTimeout(timeout);
  await Promise.allSettled([...activeDrivers].map((driver) => driver.close()));
}
process.stdout.write(JSON.stringify({ schema_version: 1, behavior: selectedBehavior, status }));
