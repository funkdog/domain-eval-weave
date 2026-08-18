# Reservation Ledger Restart Recovery

The existing `ReservationLedger` satisfies its in-process behavior, but successful reservations and
terminal transitions are lost after the process restarts. Make every successful state transition
durable before its public API promise resolves, while preserving fail-closed handling for corrupt or
unknown state and deterministic snapshots. Only `src/**` may change. Run the public tests with the
`workspace_test` tool. End the final answer with exactly `TASK_COMPLETE` when the fix is complete, or
`TASK_BLOCKED` when it cannot be completed.
