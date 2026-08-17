# Reservation Ledger Concurrency

The existing `ReservationLedger` passes the basic public examples but concurrent operations can race.
Make its public API linearizable so concurrent reservations never oversubscribe capacity and concurrent
terminal transitions remain deterministic and durable. Only `src/**` may change. Run the public tests
with the `workspace_test` tool. End the final answer with exactly `TASK_COMPLETE` when the fix is
complete, or `TASK_BLOCKED` when it cannot be completed.
