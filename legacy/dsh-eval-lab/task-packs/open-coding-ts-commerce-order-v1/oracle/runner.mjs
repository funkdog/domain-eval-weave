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
        case "refunded":
          value = await service.markRefunded(request.orderId);
          break;
        case "get":
          value = await service.getOrder(request.orderId);
          break;
        case "audit":
          value = await service.getAuditEvents(request.orderId);
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
const validCouponExpiry = "2026-08-22T00:00:00.000Z";
const expiredCouponExpiry = "2026-08-20T00:00:00.000Z";

function order(label, overrides = {}) {
  return {
    id: opaque(`order-${label}`),
    customerId: opaque(`customer-${label}`),
    status: "pending_payment",
    listAmount: 10_000,
    paidAmount: 0,
    inventoryReserved: false,
    refundStatus: "none",
    refundAmount: 0,
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

  async paid_unshipped_creates_paid_amount_refund() {
    await withDriver(candidate, async (driver) => {
      const target = order("paid", { status: "paid", paidAmount: 8_000 });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const result = await driver.call("cancel", { input: cancellation(target, "paid") });
      assert.equal(result.order.status, "cancelled");
      assert.equal(result.order.refundStatus, "pending");
      assert.equal(result.order.refundAmount, 8_000);
      assert.equal(result.refundRequested, true);
    });
  },

  async shipped_order_requires_after_sales() {
    await withDriver(candidate, async (driver) => {
      const target = order("shipped", { status: "shipped", paidAmount: 8_000 });
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      assert.equal(
        await rejects(() => driver.call("cancel", { input: cancellation(target, "shipped") })),
        true,
      );
      assert.deepEqual(await driver.call("get", { orderId: target.id }), target);
      assert.deepEqual(await driver.call("audit", { orderId: target.id }), []);
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

  async inventory_release_is_exactly_once() {
    await withDriver(candidate, async (driver) => {
      const target = order("inventory", { inventoryReserved: true });
      const input = cancellation(target, "inventory");
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      const [left, right] = await Promise.all([
        driver.call("cancel", { input }),
        driver.call("cancel", { input }),
      ]);
      assert.deepEqual(left, right);
      assert.equal((await driver.call("get", { orderId: target.id })).inventoryReserved, false);
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.filter((event) => event.type === "inventory_released").length, 1);
      assert.deepEqual(await driver.call("cancel", { input }), left);
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
      assert.deepEqual(await driver.call("audit", { orderId: target.id }), []);
    });
  },

  async restart_recovery_preserves_idempotency_and_audit() {
    const target = order("restart", {
      status: "paid",
      paidAmount: 8_000,
      inventoryReserved: true,
      coupon: { id: opaque("restart-coupon"), expiresAt: validCouponExpiry, restored: false },
    });
    const input = cancellation(target, "restart");
    let original;
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      await driver.call("create", { order: target });
      original = await driver.call("cancel", { input });
    });
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile });
      const restored = await driver.call("get", { orderId: target.id });
      assert.equal(restored.status, "cancelled");
      assert.equal(restored.refundStatus, "pending");
      assert.equal(restored.inventoryReserved, false);
      assert.equal(restored.coupon.restored, true);
      const beforeReplay = await driver.call("audit", { orderId: target.id });
      assert.equal(beforeReplay.filter((event) => event.type === "order_cancelled").length, 1);
      assert.equal(beforeReplay.filter((event) => event.type === "refund_requested").length, 1);
      assert.deepEqual(await driver.call("cancel", { input }), original);
      assert.equal(
        await rejects(() =>
          driver.call("cancel", {
            input: { ...input, customerId: opaque("restart-conflict") },
          }),
        ),
        true,
      );
      const audit = await driver.call("audit", { orderId: target.id });
      assert.equal(audit.filter((event) => event.type === "order_cancelled").length, 1);
      assert.equal(audit.filter((event) => event.type === "inventory_released").length, 1);
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
    assert.equal(persisted.version, 1);
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
