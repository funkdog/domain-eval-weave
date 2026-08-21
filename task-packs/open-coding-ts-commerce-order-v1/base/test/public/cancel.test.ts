import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { OrderService } from "../../src/order-service.ts";

test("a paid unshipped order requests its paid amount as refund", async () => {
  await mkdir(resolve("tmp"), { recursive: true });
  const root = await mkdtemp(resolve("tmp", "commerce-public-"));
  try {
    const service = await OrderService.open(resolve(root, "orders.json"));
    await service.createOrder({
      id: "order-1",
      customerId: "customer-1",
      status: "paid",
      listAmount: 10_000,
      paidAmount: 8_000,
      inventoryReserved: true,
      refundStatus: "none",
      refundAmount: 0,
    });
    const result = await service.cancelOrder({
      orderId: "order-1",
      customerId: "customer-1",
      requestId: "cancel-1",
      now: "2026-08-21T00:00:00.000Z",
    });
    assert.equal(result.order.status, "cancelled");
    assert.equal(result.order.refundStatus, "pending");
    assert.equal(result.order.refundAmount, 8_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
