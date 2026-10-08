import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ORDER_STATUSES = new Set(["pending_payment", "paid", "cancelled", "closed"]);
const FULFILLMENT_STATES = new Set(["not_started", "active", "handed_off"]);
const WITHDRAWAL_STATES = new Set(["none", "pending", "completed", "rejected", "failed"]);
const REFUND_STATUSES = new Set(["none", "pending", "refunded", "failed"]);
const POLICY_VERSION = "commerce-order-cancellation-v2";
const RETENTION_POLICY = Object.freeze({
  idempotencyDays: 90,
  financialAndOrderDays: 2555,
  securityConflictDays: 365,
  deliveryDiagnosticDays: 90,
});
const DAY_MS = 86_400_000;

function clone(value) {
  return structuredClone(value);
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`invalid ${label}`);
}

function amount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${label}`);
}

function timestamp(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error(`invalid ${label}`);
  }
}

function currency(value) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw new Error("invalid currency");
  }
}

function validateOrder(value) {
  if (!value || typeof value !== "object") throw new Error("invalid order");
  nonEmpty(value.id, "order id");
  nonEmpty(value.customerId, "customer id");
  if (!ORDER_STATUSES.has(value.status)) throw new Error("invalid order status");
  if (!FULFILLMENT_STATES.has(value.fulfillmentState)) {
    throw new Error("invalid fulfillment state");
  }
  if (!WITHDRAWAL_STATES.has(value.withdrawalState)) {
    throw new Error("invalid withdrawal state");
  }
  if (!REFUND_STATUSES.has(value.refundStatus)) throw new Error("invalid refund status");
  amount(value.listAmount, "list amount");
  amount(value.paidAmount, "paid amount");
  amount(value.refundAmount, "refund amount");
  currency(value.currency);
  if (value.paidAmount > value.listAmount) throw new Error("paid amount exceeds list amount");
  if (value.refundAmount > value.paidAmount) throw new Error("refund exceeds paid amount");
  if (typeof value.inventoryReserved !== "boolean") throw new Error("invalid inventory state");
  if (!Number.isSafeInteger(value.version) || value.version <= 0) {
    throw new Error("invalid order version");
  }
  if (value.coupon !== undefined) {
    nonEmpty(value.coupon?.id, "coupon id");
    timestamp(value.coupon?.expiresAt, "coupon expiry");
    if (typeof value.coupon?.restored !== "boolean") throw new Error("invalid coupon state");
  }
  return clone(value);
}

function validateAudit(event, index) {
  if (event?.sequence !== index + 1) throw new Error("invalid audit sequence");
  for (const [value, label] of [
    [event.orderId, "audit order id"],
    [event.requestId, "audit request id"],
    [event.operation, "audit operation"],
    [event.actorId, "audit actor"],
    [event.actorScope, "audit actor scope"],
    [event.outcome, "audit outcome"],
    [event.reason, "audit reason"],
    [event.policyVersion, "audit policy version"],
    [event.correlationId, "audit correlation"],
    [event.causationId, "audit causation"],
  ]) {
    nonEmpty(value, label);
  }
  if (event.policyVersion !== POLICY_VERSION) throw new Error("invalid audit policy version");
  if (!Number.isSafeInteger(event.beforeVersion) || !Number.isSafeInteger(event.afterVersion)) {
    throw new Error("invalid audit version");
  }
  timestamp(event.occurredAt, "audit time");
  if (event.amount !== undefined) amount(event.amount, "audit amount");
  if (event.currency !== undefined) currency(event.currency);
  return clone(event);
}

function validateState(value) {
  if (
    !value ||
    value.schemaVersion !== 2 ||
    !Array.isArray(value.orders) ||
    !Array.isArray(value.requests) ||
    !Array.isArray(value.audit)
  ) {
    throw new Error("invalid state");
  }
  const orders = value.orders.map(validateOrder);
  if (new Set(orders.map((order) => order.id)).size !== orders.length) {
    throw new Error("duplicate order");
  }
  const requests = value.requests.map((request) => {
    nonEmpty(request?.requestId, "request id");
    nonEmpty(request?.operation, "request operation");
    timestamp(request?.createdAt, "request creation time");
    if (!request.input || !request.result || typeof request.fingerprint !== "string") {
      throw new Error("invalid request replay");
    }
    return clone(request);
  });
  if (new Set(requests.map((request) => request.requestId)).size !== requests.length) {
    throw new Error("duplicate request id");
  }
  return {
    schemaVersion: 2,
    orders,
    requests,
    audit: value.audit.map(validateAudit),
  };
}

function validateCancellation(input) {
  nonEmpty(input?.orderId, "order id");
  nonEmpty(input?.customerId, "customer id");
  nonEmpty(input?.requestId, "request id");
  timestamp(input?.now, "cancellation time");
  return clone(input);
}

function validateWithdrawal(input) {
  nonEmpty(input?.orderId, "order id");
  nonEmpty(input?.requestId, "request id");
  nonEmpty(input?.providerRef, "provider ref");
  if (!new Set(["completed", "rejected", "failed"]).has(input?.outcome)) {
    throw new Error("invalid withdrawal outcome");
  }
  timestamp(input?.now, "withdrawal time");
  return clone(input);
}

function fingerprint(operation, input) {
  const { now: _now, ...semantic } = input;
  return JSON.stringify({ operation, ...semantic });
}

function customerStatus(order) {
  if (order.status === "cancelled") return "cancelled";
  if (order.fulfillmentState === "handed_off") return "after_sales_required";
  if (order.withdrawalState === "pending") return "cancellation_pending_fulfilment";
  if (order.withdrawalState === "rejected") return "cancellation_rejected";
  if (order.withdrawalState === "failed") return "cancellation_failed";
  return "open";
}

function result(order, effects = {}) {
  return {
    order: clone(order),
    customerStatus: customerStatus(order),
    inventoryReleased: effects.inventoryReleased ?? false,
    couponRestored: effects.couponRestored ?? false,
    refundRequested: effects.refundRequested ?? false,
  };
}

export class OrderService {
  #file;
  #state;
  #tail = Promise.resolve();

  constructor(file, state) {
    this.#file = file;
    this.#state = state;
  }

  static async open(file) {
    nonEmpty(file, "store path");
    await mkdir(dirname(file), { recursive: true });
    try {
      return new OrderService(file, validateState(JSON.parse(await readFile(file, "utf8"))));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const service = new OrderService(file, {
        schemaVersion: 2,
        orders: [],
        requests: [],
        audit: [],
      });
      await service.#persist(service.#state);
      return service;
    }
  }

  #enqueue(operation) {
    const pending = this.#tail.then(operation);
    this.#tail = pending.catch(() => undefined);
    return pending;
  }

  async #persist(state) {
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { flag: "wx" });
    await rename(temporary, this.#file);
  }

  async #commit(next) {
    await this.#persist(next); // MUTATE:skip_cancellation_persist
    this.#state = next;
  }

  #event(input) {
    const event = {
      sequence: this.#state.audit.length + input.offset + 1,
      orderId: input.order.id,
      requestId: input.requestId,
      type: input.type,
      operation: input.operation,
      actorId: input.actorId,
      actorScope: input.actorScope,
      outcome: input.outcome,
      reason: input.reason,
      beforeVersion: input.beforeVersion,
      afterVersion: input.afterVersion,
      policyVersion: POLICY_VERSION,
      correlationId: input.correlationId,
      causationId: input.causationId,
      occurredAt: input.now,
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.providerRef === undefined ? {} : { providerRef: input.providerRef }),
      ...(input.recoveryRef === undefined ? {} : { recoveryRef: input.recoveryRef }),
    };
    if (false) delete event.policyVersion; // MUTATE:omit_required_audit_fields
    return event;
  }

  #requestRecord(operation, input, value) {
    return {
      requestId: input.requestId,
      operation,
      fingerprint: fingerprint(operation, input),
      input: clone(input),
      result: clone(value),
      createdAt: input.now,
    };
  }

  async #auditRejected(order, input, operation, type, reason) {
    const event = this.#event({
      offset: 0,
      order,
      requestId: input.requestId,
      type,
      operation,
      actorId: operation === "cancel_order" ? input.customerId : "fulfillment-system",
      actorScope: operation === "cancel_order" ? "order-owner" : "system",
      outcome: "rejected",
      reason,
      beforeVersion: order.version,
      afterVersion: order.version,
      correlationId: input.requestId,
      causationId: input.requestId,
      now: input.now,
      providerRef: input.providerRef,
    });
    await this.#commit({ ...this.#state, audit: [...this.#state.audit, event] });
  }

  async #replayResult(replay, input, order) {
    const ageDays = (Date.parse(input.now) - Date.parse(replay.createdAt)) / DAY_MS;
    const duplicateEffect = false; // MUTATE:duplicate_inventory_on_replay
    const expiredFresh = false; // MUTATE:treat_expired_replay_as_fresh
    if (duplicateEffect || (expiredFresh && ageDays > RETENTION_POLICY.idempotencyDays)) {
      const event = this.#event({
        offset: 0,
        order,
        requestId: input.requestId,
        type: "inventory_compensated",
        operation: replay.operation,
        actorId: replay.operation === "cancel_order" ? input.customerId : "fulfillment-system",
        actorScope: replay.operation === "cancel_order" ? "order-owner" : "system",
        outcome: "replayed",
        reason: expiredFresh ? "expired request treated as fresh" : "duplicate replay effect",
        beforeVersion: order.version,
        afterVersion: order.version,
        correlationId: input.requestId,
        causationId: replay.requestId,
        now: input.now,
        recoveryRef: `replay:${replay.requestId}`,
      });
      await this.#commit({ ...this.#state, audit: [...this.#state.audit, event] });
    }
    return clone(replay.result);
  }

  async #lookupReplay(operation, input, order) {
    const replay = this.#state.requests.find((entry) => entry.requestId === input.requestId);
    if (replay === undefined) return undefined;
    if (replay.fingerprint !== fingerprint(operation, input)) {
      await this.#auditRejected(order, input, operation, "idempotency_conflict", "conflicting input");
      throw new Error("conflicting request replay");
    }
    return this.#replayResult(replay, input, order);
  }

  async #finalizeCancellation(current, orderIndex, input, operation, providerRef, prefixEvents = []) {
    const refundRequested = current.status === "paid";
    const inventoryReleased = current.inventoryReserved;
    const couponRestored =
      current.coupon !== undefined &&
      !current.coupon.restored &&
      Date.parse(current.coupon.expiresAt) >= Date.parse(input.now);
    const refundAmount = refundRequested
      ? current.paidAmount // MUTATE:refund_list_amount_or_wrong_currency
      : 0;
    const order = {
      ...current,
      status: "cancelled",
      withdrawalState: current.fulfillmentState === "active" ? "completed" : current.withdrawalState,
      inventoryReserved: false,
      ...(current.coupon === undefined
        ? {}
        : { coupon: { ...current.coupon, restored: couponRestored } }),
      refundStatus: refundRequested ? "pending" : "none",
      refundAmount,
      version: current.version + 1,
    };
    const facts = [
      ...prefixEvents,
      { type: "order_cancelled", outcome: "completed", reason: "cancellation committed" },
      ...(inventoryReleased
        ? [{ type: "inventory_compensated", outcome: "completed", reason: "inventory compensated" }]
        : []),
      ...(couponRestored
        ? [{ type: "coupon_restored", outcome: "completed", reason: "coupon remains eligible" }]
        : []),
      ...(refundRequested
        ? [
            {
              type: "refund_requested",
              outcome: "pending",
              reason: "paid cancellation requests refund",
              amount: refundAmount,
              currency: current.currency,
            },
          ]
        : []),
    ];
    const events = facts.map((fact, offset) =>
      this.#event({
        offset,
        order,
        requestId: input.requestId,
        operation,
        actorId: operation === "cancel_order" ? input.customerId : "fulfillment-system",
        actorScope: operation === "cancel_order" ? "order-owner" : "system",
        beforeVersion: current.version,
        afterVersion: order.version,
        correlationId: input.requestId,
        causationId: providerRef ?? input.requestId,
        now: input.now,
        providerRef,
        ...fact,
      }),
    );
    const value = result(order, { inventoryReleased, couponRestored, refundRequested });
    const next = {
      ...this.#state,
      orders: this.#state.orders.map((entry, index) => (index === orderIndex ? order : entry)),
      requests: [...this.#state.requests, this.#requestRecord(operation, input, value)],
      audit: [...this.#state.audit, ...events],
    };
    await this.#commit(next);
    return clone(value);
  }

  createOrder(orderValue) {
    return this.#enqueue(async () => {
      const order = validateOrder(orderValue);
      if (this.#state.orders.some((entry) => entry.id === order.id)) {
        throw new Error("order already exists");
      }
      await this.#commit({ ...this.#state, orders: [...this.#state.orders, order] });
    });
  }

  cancelOrder(inputValue) {
    return this.#enqueue(async () => {
      const input = validateCancellation(inputValue);
      const orderIndex = this.#state.orders.findIndex((entry) => entry.id === input.orderId);
      if (orderIndex < 0) throw new Error("unknown order");
      const current = this.#state.orders[orderIndex];
      const replay = await this.#lookupReplay("cancel_order", input, current);
      if (replay !== undefined) return replay;
      if (current.customerId !== input.customerId) {
        const ownershipDisabled = false; // MUTATE:disable_ownership
        if (!ownershipDisabled) {
          await this.#auditRejected(current, input, "cancel_order", "command_rejected", "ownership mismatch");
          throw new Error("order ownership mismatch");
        }
      }
      if (current.fulfillmentState === "handed_off") {
        const handedOffAllowed = false; // MUTATE:allow_handed_off_cancel
        if (!handedOffAllowed) {
          await this.#auditRejected(
            current,
            input,
            "cancel_order",
            "command_rejected",
            "carrier_handoff_committed",
          );
          throw new Error("after-sales required");
        }
      }
      if (current.status === "cancelled" || current.status === "closed") {
        await this.#auditRejected(current, input, "cancel_order", "command_rejected", "order terminal");
        throw new Error("order is terminal");
      }
      if (current.fulfillmentState === "active") {
        const prematureCancel = false; // MUTATE:cancel_before_withdrawal
        if (prematureCancel) {
          return this.#finalizeCancellation(current, orderIndex, input, "cancel_order");
        }
        const order = { ...current, withdrawalState: "pending", version: current.version + 1 };
        const facts = [
          { type: "cancellation_requested", outcome: "accepted", reason: "fulfillment active" },
          { type: "withdrawal_requested", outcome: "pending", reason: "awaiting provider" },
        ];
        const events = facts.map((fact, offset) =>
          this.#event({
            offset,
            order,
            requestId: input.requestId,
            operation: "cancel_order",
            actorId: input.customerId,
            actorScope: "order-owner",
            beforeVersion: current.version,
            afterVersion: order.version,
            correlationId: input.requestId,
            causationId: input.requestId,
            now: input.now,
            ...fact,
          }),
        );
        const value = result(order);
        await this.#commit({
          ...this.#state,
          orders: this.#state.orders.map((entry, index) => (index === orderIndex ? order : entry)),
          requests: [...this.#state.requests, this.#requestRecord("cancel_order", input, value)],
          audit: [...this.#state.audit, ...events],
        });
        return clone(value);
      }
      return this.#finalizeCancellation(current, orderIndex, input, "cancel_order");
    });
  }

  resolveWithdrawal(inputValue) {
    return this.#enqueue(async () => {
      const input = validateWithdrawal(inputValue);
      const orderIndex = this.#state.orders.findIndex((entry) => entry.id === input.orderId);
      if (orderIndex < 0) throw new Error("unknown order");
      const current = this.#state.orders[orderIndex];
      const replay = await this.#lookupReplay("resolve_withdrawal", input, current);
      if (replay !== undefined) return replay;
      if (current.withdrawalState !== "pending" || current.fulfillmentState !== "active") {
        await this.#auditRejected(
          current,
          input,
          "resolve_withdrawal",
          "command_rejected",
          "withdrawal is not pending",
        );
        throw new Error("withdrawal is not pending");
      }
      const rejectCreatesEffects = false; // MUTATE:apply_effects_on_withdrawal_rejection
      const failureCreatesEffects = false; // MUTATE:apply_effects_on_withdrawal_failure
      if (
        input.outcome === "completed" ||
        (input.outcome === "rejected" && rejectCreatesEffects) ||
        (input.outcome === "failed" && failureCreatesEffects)
      ) {
        return this.#finalizeCancellation(current, orderIndex, input, "resolve_withdrawal", input.providerRef, [
          {
            type: "withdrawal_completed",
            outcome: "completed",
            reason: "provider completed withdrawal",
            providerRef: input.providerRef,
          },
        ]);
      }
      const withdrawalState = input.outcome;
      const order = { ...current, withdrawalState, version: current.version + 1 };
      const type = input.outcome === "rejected" ? "withdrawal_rejected" : "withdrawal_failed";
      const event = this.#event({
        offset: 0,
        order,
        requestId: input.requestId,
        type,
        operation: "resolve_withdrawal",
        actorId: "fulfillment-system",
        actorScope: "system",
        outcome: input.outcome,
        reason: `provider ${input.outcome} withdrawal`,
        beforeVersion: current.version,
        afterVersion: order.version,
        correlationId: input.requestId,
        causationId: input.providerRef,
        now: input.now,
        providerRef: input.providerRef,
      });
      const value = result(order);
      await this.#commit({
        ...this.#state,
        orders: this.#state.orders.map((entry, index) => (index === orderIndex ? order : entry)),
        requests: [...this.#state.requests, this.#requestRecord("resolve_withdrawal", input, value)],
        audit: [...this.#state.audit, event],
      });
      return clone(value);
    });
  }

  markRefunded(orderId) {
    return this.#enqueue(async () => {
      nonEmpty(orderId, "order id");
      const index = this.#state.orders.findIndex((entry) => entry.id === orderId);
      if (index < 0) throw new Error("unknown order");
      const current = this.#state.orders[index];
      if (current.refundStatus === "refunded") return clone(current);
      if (current.status !== "cancelled" || current.refundStatus !== "pending") {
        throw new Error("refund is not pending");
      }
      const last = [...this.#state.audit].reverse().find((event) => event.orderId === orderId);
      if (last === undefined) throw new Error("missing cancellation audit");
      const order = { ...current, refundStatus: "refunded", version: current.version + 1 };
      const event = this.#event({
        offset: 0,
        order,
        requestId: last.requestId,
        type: "refund_completed",
        operation: "mark_refunded",
        actorId: "payment-system",
        actorScope: "system",
        outcome: "completed",
        reason: "refund settled",
        beforeVersion: current.version,
        afterVersion: order.version,
        correlationId: last.correlationId,
        causationId: last.requestId,
        now: last.occurredAt,
        amount: current.refundAmount,
        currency: current.currency,
      });
      await this.#commit({
        ...this.#state,
        orders: this.#state.orders.map((entry, orderIndex) =>
          orderIndex === index ? order : entry,
        ),
        audit: [...this.#state.audit, event],
      });
      return clone(order);
    });
  }

  getOrder(orderId) {
    return this.#enqueue(async () => {
      nonEmpty(orderId, "order id");
      return clone(this.#state.orders.find((entry) => entry.id === orderId) ?? null);
    });
  }

  getAuditEvents(orderId) {
    return this.#enqueue(async () => {
      nonEmpty(orderId, "order id");
      return clone(this.#state.audit.filter((event) => event.orderId === orderId));
    });
  }

  getRetentionPolicy() {
    return this.#enqueue(async () => clone(RETENTION_POLICY));
  }
}
