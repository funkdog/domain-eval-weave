# OrderService public contract

Implement durable self-service order cancellation in `src/order-service.ts`.

- `pending_payment` orders cancel without a refund.
- `paid` orders cancel into `refundStatus: "pending"`; `refundAmount` equals `paidAmount`.
- `shipped` orders require after-sales and cannot be cancelled through this API.
- cancellation and refund completion are separate transitions.
- inventory release, eligible coupon restoration, request idempotency, customer ownership, restart recovery,
  and audit durability are part of the public contract.

Amounts are non-negative safe integers. Timestamps are canonical UTC strings. Only `src/**` may be edited.
