import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { OrderService } from "../../src/order-service.ts";

test("active fulfillment is pending until withdrawal completes", async () => {
  await mkdir(resolve("tmp"), { recursive: true });
  const root = await mkdtemp(resolve("tmp", "commerce-withdrawal-public-"));
  try {
    const service = await OrderService.open(resolve(root, "orders.json"));
    await service.createOrder({
      id: "order-active",
      customerId: "customer-1",
      status: "paid",
      fulfillmentState: "active",
      withdrawalState: "none",
      listAmount: 10_000,
      paidAmount: 8_000,
      currency: "USD",
      inventoryReserved: true,
      refundStatus: "none",
      refundAmount: 0,
      version: 1,
    });
    const pending = await service.cancelOrder({
      orderId: "order-active",
      customerId: "customer-1",
      requestId: "cancel-active",
      now: "2026-08-22T00:00:00.000Z",
    });
    assert.equal(pending.order.status, "paid");
    assert.equal(pending.order.withdrawalState, "pending");
    assert.equal(pending.customerStatus, "cancellation_pending_fulfilment");
    assert.equal(pending.refundRequested, false);

    const completed = await service.resolveWithdrawal({
      orderId: "order-active",
      requestId: "withdrawal-active",
      providerRef: "warehouse-1",
      outcome: "completed",
      now: "2026-08-22T00:01:00.000Z",
    });
    assert.equal(completed.order.status, "cancelled");
    assert.equal(completed.order.withdrawalState, "completed");
    assert.equal(completed.customerStatus, "cancelled");
    assert.equal(completed.order.refundAmount, 8_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
