# Reservation Ledger Release Recovery

The existing `ReservationLedger` persists reservations and commits across process restarts, but a
successful release is reflected only in memory. Make release durable before its public API promise
resolves. Preserve idempotent release replay, reject a later conflicting commit, and ensure a reopened
snapshot retains the released state and restored capacity. Keep corrupt or unknown state fail-closed
and snapshots deterministic. Only `src/**` may change. Run the public tests with the `workspace_test`
tool. End the final answer with exactly `TASK_COMPLETE` when the fix is complete, or `TASK_BLOCKED`
when it cannot be completed.
