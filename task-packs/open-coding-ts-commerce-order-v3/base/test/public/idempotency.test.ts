import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { OrderService } from "../../src/order-service.ts";
import { accepted } from "./helpers.ts";

test("an exact cancellation request is idempotent", async () => {
  await mkdir(resolve("tmp"), { recursive: true });
  const root = await mkdtemp(resolve("tmp", "commerce-idempotency-"));
  try {
    const service = await OrderService.open(resolve(root, "orders.json"));
    await service.createOrder({
      id: "order-1",
      customerId: "customer-1",
      status: "pending_payment",
      fulfillmentState: "not_started",
      withdrawalState: "none",
      listAmount: 10_000,
      paidAmount: 0,
      currency: "USD",
      inventoryReserved: true,
      refundStatus: "none",
      refundAmount: 0,
      version: 1,
    });
    const request = {
      orderId: "order-1",
      customerId: "customer-1",
      requestId: "cancel-1",
      now: "2026-08-21T00:00:00.000Z",
    };
    assert.deepEqual(
      accepted(await service.cancelOrder(request)),
      accepted(await service.cancelOrder(request)),
    );
    assert.equal(
      accepted(await service.getAuditEvents("order-1")).filter(
        (event) => event.type === "inventory_compensated",
      ).length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
