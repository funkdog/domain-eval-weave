import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
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
for await (const line of input) {
  let request;
  try {
    request = JSON.parse(line);
    let value;
    switch (request.operation) {
      case "open": service = await OrderService.open(request.file); value = true; break;
      case "create": value = await service.createOrder(request.order); break;
      case "cancel": value = await service.cancelOrder(request.input); break;
      case "withdrawal": value = await service.resolveWithdrawal(request.input); break;
      case "refunded": value = await service.markRefunded(request.orderId); break;
      case "get": value = await service.getOrder(request.orderId); break;
      case "audit": value = await service.getAuditEvents(request.orderId); break;
      case "retention": value = await service.getRetentionPolicy(); break;
      default: throw new Error("unknown operation");
    }
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, value }) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ id: request?.id, ok: false }) + "\n");
  }
}
`;

class CandidateDriver {
  #child;
  #nextId = 0;
  #pending = new Map();
  #closed;

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
      else pending.reject(new Error("candidate operation rejected"));
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
    this.#child.stdin.end();
    const timer = setTimeout(() => this.#child.kill("SIGKILL"), 500);
    try {
      await this.#closed;
    } finally {
      clearTimeout(timer);
    }
  }
}

function unwrap(value) {
  if (value?.status === "accepted" && Object.keys(value).sort().join(",") === "status,value") {
    return { status: "accepted", value: value.value };
  }
  if (value?.status === "rejected" && Object.keys(value).join(",") === "status") {
    return { status: "rejected" };
  }
  return { status: "accepted", value };
}

async function attempt(driver, operation, fields = {}) {
  try {
    return unwrap(await driver.call(operation, fields));
  } catch {
    return { status: "rejected" };
  }
}

class CandidateOperationRejected extends Error {}

async function accepted(driver, operation, fields = {}) {
  const result = await attempt(driver, operation, fields);
  if (result.status !== "accepted") {
    throw new CandidateOperationRejected(`${operation} was rejected`);
  }
  return result.value;
}

const args = argumentsMap(process.argv.slice(2));
process.execArgv.splice(0, process.execArgv.length);
if ("_eval" in process) delete process._eval;
const candidate = resolve(args.get("--candidate"));
const scratch = resolve(args.get("--scratch"));
const seed = Number(args.get("--seed"));
const scenario = args.get("--scenario");
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("invalid seed");
await mkdir(scratch, { recursive: true });

const opaque = (label) =>
  `commerce-${createHash("sha256").update(`${seed}:${label}`).digest("hex").slice(0, 16)}`;
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

function withdrawal(target, label, outcome) {
  return {
    orderId: target.id,
    requestId: opaque(`withdrawal-${label}`),
    providerRef: opaque(`provider-${label}`),
    outcome,
    now: "2026-08-22T00:01:00.000Z",
  };
}

function field(field_id, domain_id, scalar) {
  return { field_id, value: { domain_id, scalar } };
}

function normalizedState(value, now = time) {
  if (!value || typeof value !== "object") return [];
  const values = [];
  if (["pending_payment", "paid", "cancelled"].includes(value.status)) {
    values.push(field("order_status", "order_status_enum", value.status));
  }
  if (["not_started", "active", "handed_off"].includes(value.fulfillmentState)) {
    values.push(field("fulfillment_state", "fulfillment_state_enum", value.fulfillmentState));
  }
  if (["none", "pending", "completed", "rejected", "failed"].includes(value.withdrawalState)) {
    values.push(field("withdrawal_state", "withdrawal_state_enum", value.withdrawalState));
  }
  if (["none", "pending", "refunded"].includes(value.refundStatus)) {
    values.push(field("refund_status", "refund_status_enum", value.refundStatus));
  }
  if (Number.isSafeInteger(value.refundAmount) && value.refundAmount >= 0) {
    values.push(field("refund_amount", "nonnegative_minor_units", value.refundAmount));
  }
  if (value.currency === "USD") values.push(field("currency", "currency_enum", "USD"));
  if (typeof value.inventoryReserved === "boolean") {
    values.push(field("inventory_reserved", "boolean", value.inventoryReserved));
  }
  const couponState =
    value.coupon === undefined
      ? "absent"
      : value.coupon.restored === true
        ? "restored"
        : Date.parse(value.coupon.expiresAt) >= Date.parse(now)
          ? "eligible"
          : "expired";
  values.push(field("coupon_state", "coupon_state_enum", couponState));
  if (Number.isSafeInteger(value.version) && value.version >= 1) {
    values.push(field("version", "positive_version", value.version));
  }
  return values;
}

function effect(event) {
  const knownType = new Set([
    "order_cancelled",
    "refund_requested",
    "inventory_compensated",
    "coupon_restored",
    "command_rejected",
    "withdrawal_requested",
    "withdrawal_completed",
    "idempotency_conflict",
  ]);
  const base = {
    orderId: typeof event?.orderId === "string" ? event.orderId : undefined,
    requestId: typeof event?.requestId === "string" ? event.requestId : undefined,
  };
  if (base.orderId === undefined || base.requestId === undefined) {
    return knownType.has(event?.type) ? { invalid_effect_id: event.type } : undefined;
  }
  const requestIdentity = [
    { field_id: "order_id", value: base.orderId },
    { field_id: "request_id", value: base.requestId },
  ];
  const effectIdentity = [
    { field_id: "order_id", value: base.orderId },
    { field_id: "effect_key", value: base.requestId },
  ];
  switch (event.type) {
    case "order_cancelled":
      return { effect_id: "order_cancelled", identity: requestIdentity, attributes: [] };
    case "refund_requested":
      return Number.isSafeInteger(event.amount) && event.amount >= 0 && event.currency === "USD"
        ? {
            effect_id: "refund_requested",
            identity: effectIdentity,
            attributes: [
              { field_id: "amount", value: event.amount },
              { field_id: "currency", value: event.currency },
            ],
          }
        : { invalid_effect_id: "refund_requested" };
    case "inventory_compensated":
      return { effect_id: "inventory_compensated", identity: effectIdentity, attributes: [] };
    case "coupon_restored":
      return {
        effect_id: "coupon_restored",
        identity: effectIdentity,
        attributes: [{ field_id: "eligibility", value: true }],
      };
    case "command_rejected":
      return { effect_id: "command_rejected", identity: requestIdentity, attributes: [] };
    case "withdrawal_requested":
    case "withdrawal_completed":
      return {
        effect_id: event.type,
        identity: requestIdentity,
        attributes: [
          {
            field_id: "provider_ref",
            value:
              typeof event.providerRef === "string" && event.providerRef.length > 0
                ? event.providerRef
                : base.requestId,
          },
        ],
      };
    case "idempotency_conflict":
      return { effect_id: "idempotency_conflict", identity: requestIdentity, attributes: [] };
    default:
      return undefined;
  }
}

function normalForm(status, orderValue, auditValue = [], relations = []) {
  const projected = Array.isArray(auditValue)
    ? auditValue.map(effect).filter((value) => value !== undefined)
    : [];
  const invalidEffectIds = new Set(
    projected
      .filter((value) => "invalid_effect_id" in value)
      .map((value) => value.invalid_effect_id),
  );
  const effects = projected.filter(
    (value) => "effect_id" in value && !invalidEffectIds.has(value.effect_id),
  );
  return {
    schema_version: 1,
    operation: { status },
    state: normalizedState(orderValue),
    effects,
    relations,
  };
}

const requiredAuditFields = [
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
];

function auditContractValid(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (event) =>
        event &&
        typeof event === "object" &&
        requiredAuditFields.every((fieldName) => fieldName in event) &&
        event.policyVersion === "commerce-order-cancellation-v2" &&
        typeof event.reason === "string",
    )
  );
}

async function observeAudit(driver, orderId) {
  const result = await attempt(driver, "audit", { orderId });
  return {
    status: result.status,
    events: Array.isArray(result.value) ? result.value : [],
  };
}

async function withDriver(file, operation) {
  const driver = new CandidateDriver(candidate);
  try {
    await accepted(driver, "open", { file });
    return await operation(driver);
  } finally {
    await driver.close();
  }
}

const scenarios = {
  async "paid-unstarted"() {
    const file = resolve(scratch, "paid.json");
    const target = order("paid", {
      status: "paid",
      paidAmount: 8_000,
      inventoryReserved: true,
    });
    return withDriver(file, async (driver) => {
      const operations = {};
      operations.create_order = (await attempt(driver, "create", { order: target })).status;
      const before = normalForm("accepted", target);
      const cancel = await attempt(driver, "cancel", {
        input: cancellation(target, "paid"),
      });
      operations.cancel_order = cancel.status;
      const cancelled = cancel.value?.order;
      const audit = await observeAudit(driver, target.id);
      operations.get_audit =
        audit.status === "accepted" && auditContractValid(audit.events)
          ? "accepted"
          : "unavailable";
      const got = await attempt(driver, "get", { orderId: target.id });
      operations.get_order = got.status;
      const after = normalForm(cancel.status, got.value ?? cancelled, audit.events);
      const refunded = await attempt(driver, "refunded", { orderId: target.id });
      operations.mark_refunded = refunded.status;
      const refundedAudit = await observeAudit(driver, target.id);
      const replay = normalForm(refunded.status, refunded.value, refundedAudit.events);
      return {
        operations,
        normal_forms: { before, after, replay },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "active-completion"() {
    const file = resolve(scratch, "active.json");
    const target = order("active", {
      status: "paid",
      paidAmount: 8_000,
      fulfillmentState: "active",
      inventoryReserved: true,
    });
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      const cancel = await accepted(driver, "cancel", {
        input: cancellation(target, "active"),
      });
      const completed = await attempt(driver, "withdrawal", {
        input: withdrawal(target, "active", "completed"),
      });
      const audit = await observeAudit(driver, target.id);
      const withdrawalIndex = audit.events.findIndex(
        (event) => event.type === "withdrawal_completed",
      );
      const cancellationIndex = audit.events.findIndex(
        (event) => event.type === "order_cancelled",
      );
      return {
        operations: { cancel_order: "accepted", resolve_withdrawal: completed.status },
        normal_forms: {
          before: normalForm("accepted", cancel.order, audit.events),
          after: normalForm(completed.status, completed.value?.order, audit.events, [
            {
              relation_id: "withdrawal_before_cancellation",
              status:
                withdrawalIndex >= 0 && cancellationIndex >= 0 && withdrawalIndex < cancellationIndex,
            },
          ]),
        },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "handoff-rejection"() {
    const file = resolve(scratch, "handoff.json");
    const target = order("handoff", {
      status: "paid",
      paidAmount: 8_000,
      fulfillmentState: "handed_off",
    });
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      const cancelled = await attempt(driver, "cancel", {
        input: cancellation(target, "handoff"),
      });
      const current = await accepted(driver, "get", { orderId: target.id });
      const audit = await observeAudit(driver, target.id);
      return {
        operations: { cancel_order: cancelled.status },
        normal_forms: { after: normalForm(cancelled.status, current, audit.events) },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "ownership-rejection"() {
    const file = resolve(scratch, "ownership.json");
    const target = order("ownership", { status: "paid", paidAmount: 8_000 });
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      const cancelled = await attempt(driver, "cancel", {
        input: cancellation(target, "ownership", {
          customerId: opaque("other-customer"),
        }),
      });
      const current = await accepted(driver, "get", { orderId: target.id });
      const audit = await observeAudit(driver, target.id);
      return {
        operations: { cancel_order: cancelled.status },
        normal_forms: { after: normalForm(cancelled.status, current, audit.events) },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "active-rejection"() {
    const file = resolve(scratch, "active-rejection.json");
    const target = order("active-rejection", {
      status: "paid",
      paidAmount: 8_000,
      fulfillmentState: "active",
      inventoryReserved: true,
      coupon: { id: opaque("rejection-coupon"), expiresAt: validCouponExpiry, restored: false },
    });
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      await accepted(driver, "cancel", { input: cancellation(target, "active-rejection") });
      const resolved = await attempt(driver, "withdrawal", {
        input: withdrawal(target, "active-rejection", "rejected"),
      });
      const audit = await observeAudit(driver, target.id);
      return {
        operations: { resolve_withdrawal: resolved.status },
        normal_forms: { after: normalForm(resolved.status, resolved.value?.order, audit.events) },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "active-failure"() {
    const file = resolve(scratch, "active-failure.json");
    const target = order("active-failure", {
      status: "paid",
      paidAmount: 8_000,
      fulfillmentState: "active",
      inventoryReserved: true,
    });
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      await accepted(driver, "cancel", { input: cancellation(target, "active-failure") });
      const resolved = await attempt(driver, "withdrawal", {
        input: withdrawal(target, "active-failure", "failed"),
      });
      const audit = await observeAudit(driver, target.id);
      return {
        operations: { resolve_withdrawal: resolved.status },
        normal_forms: { after: normalForm(resolved.status, resolved.value?.order, audit.events) },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "coupon-eligibility"() {
    const file = resolve(scratch, "coupon.json");
    const target = order("coupon-valid", {
      inventoryReserved: true,
      coupon: { id: opaque("coupon-valid"), expiresAt: validCouponExpiry, restored: false },
    });
    const expired = order("coupon-expired", {
      inventoryReserved: true,
      coupon: { id: opaque("coupon-expired"), expiresAt: expiredCouponExpiry, restored: false },
    });
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      await accepted(driver, "create", { order: expired });
      const cancelled = await accepted(driver, "cancel", {
        input: cancellation(target, "coupon-valid"),
      });
      const audit = await observeAudit(driver, target.id);
      const expiredCancelled = await accepted(driver, "cancel", {
        input: cancellation(expired, "coupon-expired"),
      });
      const expiredAudit = await observeAudit(driver, expired.id);
      return {
        operations: { cancel_order: "accepted" },
        normal_forms: {
          after: normalForm("accepted", cancelled.order, audit.events),
          replay: normalForm("accepted", expiredCancelled.order, expiredAudit.events),
        },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "request-replay"() {
    const file = resolve(scratch, "replay.json");
    const target = order("replay", { inventoryReserved: true });
    const input = cancellation(target, "replay");
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      const first = await accepted(driver, "cancel", { input });
      const firstAudit = await observeAudit(driver, target.id);
      const replay = await accepted(driver, "cancel", { input });
      await attempt(driver, "cancel", {
        input: { ...input, customerId: opaque("other-customer") },
      });
      const replayAudit = await observeAudit(driver, target.id);
      const relation = {
        relation_id: "request_replay_same_as_first",
        status: JSON.stringify(first) === JSON.stringify(replay),
      };
      return {
        operations: { cancel_order: "accepted" },
        normal_forms: {
          first: normalForm("accepted", first.order, firstAudit.events),
          replay: normalForm("accepted", replay.order, replayAudit.events, [relation]),
        },
        stimuli: {},
        retention_age_ms: {},
      };
    });
  },

  async "expired-replay"() {
    const file = resolve(scratch, "expired-replay.json");
    const target = order("expired-replay", {
      status: "paid",
      paidAmount: 8_000,
      inventoryReserved: true,
    });
    const originalInput = cancellation(target, "expired-replay", {
      now: "2026-01-01T00:00:00.000Z",
    });
    return withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      const first = await accepted(driver, "cancel", { input: originalInput });
      const firstAudit = await observeAudit(driver, target.id);
      const delayed = await attempt(driver, "cancel", {
        input: { ...originalInput, now: "2026-04-02T00:00:00.000Z" },
      });
      const current = await accepted(driver, "get", { orderId: target.id });
      const replayAudit = await observeAudit(driver, target.id);
      const retention = await accepted(driver, "retention");
      const firstForm = normalForm("accepted", first.order, firstAudit.events);
      const replayBase = normalForm(
        delayed.status,
        delayed.value?.order ?? current,
        replayAudit.events,
      );
      const preserved =
        delayed.status === "accepted"
          ? JSON.stringify(first) === JSON.stringify(delayed.value)
          : JSON.stringify(firstForm.state) === JSON.stringify(replayBase.state) &&
            JSON.stringify(firstForm.effects) === JSON.stringify(replayBase.effects);
      const replay = {
        ...replayBase,
        relations: [{ relation_id: "request_replay_same_as_first", status: preserved }],
      };
      return {
        operations: { cancel_order: delayed.status, get_retention: "accepted" },
        normal_forms: { first: firstForm, replay },
        stimuli: {},
        retention_age_ms: {
          retention_clock: retention.idempotencyDays * 24 * 60 * 60 * 1_000,
        },
      };
    });
  },

  async "restart-recovery"() {
    const file = resolve(scratch, "restart.json");
    const target = order("restart", {
      status: "paid",
      paidAmount: 8_000,
      fulfillmentState: "active",
      inventoryReserved: true,
    });
    let before;
    let cancellationStatus;
    await withDriver(file, async (driver) => {
      await accepted(driver, "create", { order: target });
      const pending = await attempt(driver, "cancel", {
        input: cancellation(target, "restart"),
      });
      cancellationStatus = pending.status;
      const current =
        pending.status === "accepted"
          ? pending.value?.order
          : await accepted(driver, "get", { orderId: target.id });
      const audit = await observeAudit(driver, target.id);
      before = normalForm(pending.status, current, audit.events);
    });
    const driver = new CandidateDriver(candidate);
    try {
      const opened = await attempt(driver, "open", { file });
      if (opened.status !== "accepted") {
        return {
          operations: {
            cancel_order: cancellationStatus,
            get_order: "unavailable",
            get_audit: "unavailable",
          },
          normal_forms: {
            before,
            restart: normalForm("unavailable", undefined, [], [
              { relation_id: "restart_preserves_public_state", status: false },
            ]),
          },
          stimuli: {},
          retention_age_ms: {},
        };
      }
      const current = await accepted(driver, "get", { orderId: target.id });
      const audit = await observeAudit(driver, target.id);
      const restartBase = normalForm(audit.status, current, audit.events);
      const preserved = JSON.stringify(before) === JSON.stringify(restartBase);
      const restart = { ...restartBase, relations: [
        { relation_id: "restart_preserves_public_state", status: preserved },
      ] };
      return {
        operations: {
          cancel_order: cancellationStatus,
          get_order: "accepted",
          get_audit:
            audit.status === "accepted" && auditContractValid(audit.events)
              ? "accepted"
              : "unavailable",
        },
        normal_forms: { before, restart },
        stimuli: {},
        retention_age_ms: {},
      };
    } finally {
      await driver.close();
    }
  },

  async "retention-policy"() {
    const file = resolve(scratch, "retention.json");
    return withDriver(file, async (driver) => {
      const target = order("retention", {
        status: "paid",
        paidAmount: 8_000,
        inventoryReserved: true,
      });
      await accepted(driver, "create", { order: target });
      const cancelled = await attempt(driver, "cancel", {
        input: cancellation(target, "retention"),
      });
      const audit = await observeAudit(driver, target.id);
      const retention = await attempt(driver, "retention");
      const age = Number.isSafeInteger(retention.value?.idempotencyDays)
        ? retention.value.idempotencyDays * 24 * 60 * 60 * 1_000
        : Number.MAX_SAFE_INTEGER;
      return {
        operations: {
          cancel_order: cancelled.status,
          get_audit:
            audit.status === "accepted" && auditContractValid(audit.events)
              ? "accepted"
              : "unavailable",
          get_retention: retention.status,
        },
        normal_forms: {
          after: normalForm(
            retention.status,
            cancelled.value?.order ?? target,
            audit.events,
          ),
        },
        stimuli: {},
        retention_age_ms: { retention_clock: age },
      };
    });
  },
};

const run = scenarios[scenario];
if (run === undefined) throw new Error("unknown scenario");
const timeoutMs = Number(args.get("--timeout-ms"));
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout");
let timer;
try {
  let value;
  try {
    value = await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("scenario timeout")), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (!(error instanceof CandidateOperationRejected)) throw error;
    const unavailable = normalForm("unavailable", undefined, [], [
      { relation_id: "withdrawal_before_cancellation", status: false },
      { relation_id: "request_replay_same_as_first", status: false },
      { relation_id: "restart_preserves_public_state", status: false },
    ]);
    value = {
      operations: Object.fromEntries([
        "create_order",
        "cancel_order",
        "resolve_withdrawal",
        "mark_refunded",
        "get_order",
        "get_audit",
        "get_retention",
      ].map((operationId) => [operationId, "unavailable"])),
      normal_forms: Object.fromEntries(
        ["before", "after", "first", "replay", "restart"].map((slot) => [slot, unavailable]),
      ),
      stimuli: {},
      retention_age_ms: { retention_clock: Number.MAX_SAFE_INTEGER },
    };
  }
  process.stdout.write(JSON.stringify({ schema_version: 1, scenario, ...value }));
} finally {
  clearTimeout(timer);
}
