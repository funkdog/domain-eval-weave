# OrderService fulfillment-withdrawal contract

Implement durable self-service order cancellation in `src/order-service.ts` using the orthogonal
state types in `src/types.ts`.

- `pending_payment` orders with unstarted fulfillment cancel without a refund.
- `paid` orders with unstarted fulfillment cancel into `refundStatus: "pending"`; `refundAmount`
  equals `paidAmount` and keeps the order currency.
- `active` fulfillment enters `withdrawalState: "pending"`; the order does not become `cancelled`
  until `resolveWithdrawal(...completed)`.
- rejected or failed withdrawal leaves the order uncancelled and creates no refund, inventory, or
  coupon effect.
- `handed_off` fulfillment requires after-sales and cannot use self-service cancellation.
- cancellation, fulfillment withdrawal, refund completion, inventory compensation, and coupon
  restoration are separate durable facts.
- request replay/conflict, ownership, restart recovery, delayed replay, audit completeness, and the
  exact retention policy are part of the contract.

The transport contract permits either direct successful values or the declared `OperationResult<T>`
envelope. A rejected operation may throw or return `{ status: "rejected" }`; these forms carry the
same domain outcome. Non-authoritative error text and internal persistence layout are not part of the
contract.

Amounts are non-negative safe integer minor units. Currency is `USD` in this frozen synthetic task.
Timestamps are canonical UTC strings. The store is one physical JSON file under the supplied
workspace path. Only `src/**` and `test/agent/**` may be edited.
