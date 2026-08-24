# Commerce Order Cancellation with Fulfillment Withdrawal

Implement `OrderService` using the public contract in `README.md`. Work test-first: add focused
behavior tests under `test/agent/**`, observe them fail for the missing behavior, implement the
smallest coherent production change under `src/**`, then run the public and agent-authored tests.

The public seams `OrderService.open`, `createOrder`, `cancelOrder`, `resolveWithdrawal`,
`markRefunded`, `getOrder`, `getAuditEvents`, and `getRetentionPolicy` are preconfirmed by the
operator. No design-seam confirmation is needed during this task. Do not use or request a separate
`codebase-design` workflow.

Only `src/**` and `test/agent/**` may change. End the final answer with exactly `TASK_COMPLETE` when
complete, or `TASK_BLOCKED` when it cannot be completed.
