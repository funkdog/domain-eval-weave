import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ORDER_STATUSES = new Set(["pending_payment", "paid", "shipped", "cancelled"]);
const REFUND_STATUSES = new Set(["none", "pending", "refunded"]);

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

function validateOrder(value) {
  if (!value || typeof value !== "object") throw new Error("invalid order");
  nonEmpty(value.id, "order id");
  nonEmpty(value.customerId, "customer id");
  if (!ORDER_STATUSES.has(value.status)) throw new Error("invalid order status");
  amount(value.listAmount, "list amount");
  amount(value.paidAmount, "paid amount");
  amount(value.refundAmount, "refund amount");
  if (value.paidAmount > value.listAmount) throw new Error("paid amount exceeds list amount");
  if (typeof value.inventoryReserved !== "boolean") throw new Error("invalid inventory state");
  if (!REFUND_STATUSES.has(value.refundStatus)) throw new Error("invalid refund status");
  if (value.coupon !== undefined) {
    nonEmpty(value.coupon?.id, "coupon id");
    timestamp(value.coupon?.expiresAt, "coupon expiry");
    if (typeof value.coupon?.restored !== "boolean") throw new Error("invalid coupon state");
  }
  return clone(value);
}

function validateState(value) {
  if (
    !value ||
    value.version !== 1 ||
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
  for (const request of value.requests) {
    nonEmpty(request?.requestId, "request id");
    if (!request.input || !request.result) throw new Error("invalid request replay");
  }
  for (const [index, event] of value.audit.entries()) {
    if (event?.sequence !== index + 1) throw new Error("invalid audit sequence");
    nonEmpty(event.orderId, "audit order id");
    nonEmpty(event.requestId, "audit request id");
    timestamp(event.occurredAt, "audit time");
  }
  return { version: 1, orders, requests: clone(value.requests), audit: clone(value.audit) };
}

function validateCancellation(input) {
  nonEmpty(input?.orderId, "order id");
  nonEmpty(input?.customerId, "customer id");
  nonEmpty(input?.requestId, "request id");
  timestamp(input?.now, "cancellation time");
  return clone(input);
}

function sameInput(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
      const service = new OrderService(file, { version: 1, orders: [], requests: [], audit: [] });
      await service.#persist(service.#state);
      return service;
    }
  }

  #enqueue(operation) {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #persist(state) {
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { flag: "wx" });
    await rename(temporary, this.#file);
  }

  createOrder(orderValue) {
    return this.#enqueue(async () => {
      const order = validateOrder(orderValue);
      if (this.#state.orders.some((entry) => entry.id === order.id)) {
        throw new Error("order already exists");
      }
      const next = { ...this.#state, orders: [...this.#state.orders, order] };
      await this.#persist(next);
      this.#state = next;
    });
  }

  cancelOrder(inputValue) {
    return this.#enqueue(async () => {
      const input = validateCancellation(inputValue);
      const replay = this.#state.requests.find((entry) => entry.requestId === input.requestId);
      if (replay !== undefined) {
        if (!sameInput(replay.input, input)) throw new Error("conflicting cancellation replay");
        return clone(replay.result);
      }
      const orderIndex = this.#state.orders.findIndex((entry) => entry.id === input.orderId);
      if (orderIndex < 0) throw new Error("unknown order");
      const current = this.#state.orders[orderIndex];
      if (current.customerId !== input.customerId) throw new Error("order ownership mismatch");
      if (current.status === "shipped") throw new Error("after-sales required");
      if (current.status === "cancelled") throw new Error("order already cancelled");

      const refundRequested = current.status === "paid";
      const inventoryReleased = current.inventoryReserved;
      const couponRestored =
        current.coupon !== undefined &&
        !current.coupon.restored &&
        Date.parse(current.coupon.expiresAt) >= Date.parse(input.now);
      const order = {
        ...current,
        status: "cancelled",
        inventoryReserved: false,
        ...(current.coupon === undefined
          ? {}
          : { coupon: { ...current.coupon, restored: couponRestored } }),
        refundStatus: refundRequested ? "pending" : "none",
        refundAmount: refundRequested ? current.paidAmount : 0,
      };
      const events = [
        { type: "order_cancelled" },
        ...(inventoryReleased ? [{ type: "inventory_released" }] : []),
        ...(couponRestored ? [{ type: "coupon_restored" }] : []),
        ...(refundRequested ? [{ type: "refund_requested", amount: current.paidAmount }] : []),
      ].map((event, index) => ({
        sequence: this.#state.audit.length + index + 1,
        orderId: current.id,
        requestId: input.requestId,
        occurredAt: input.now,
        ...event,
      }));
      const result = { order: clone(order), inventoryReleased, couponRestored, refundRequested };
      const next = {
        ...this.#state,
        orders: this.#state.orders.map((entry, index) => (index === orderIndex ? order : entry)),
        requests: [...this.#state.requests, { requestId: input.requestId, input, result }],
        audit: [...this.#state.audit, ...events],
      };
      await this.#persist(next); // cancellation commit
      this.#state = next;
      return clone(result);
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
      const order = { ...current, refundStatus: "refunded" };
      const event = {
        sequence: this.#state.audit.length + 1,
        orderId,
        requestId: last.requestId,
        type: "refund_completed",
        occurredAt: last.occurredAt,
        amount: current.refundAmount,
      };
      const next = {
        ...this.#state,
        orders: this.#state.orders.map((entry, orderIndex) =>
          orderIndex === index ? order : entry,
        ),
        audit: [...this.#state.audit, event],
      };
      await this.#persist(next);
      this.#state = next;
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
}
