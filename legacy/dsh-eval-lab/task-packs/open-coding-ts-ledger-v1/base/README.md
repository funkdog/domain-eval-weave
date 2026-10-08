# ReservationLedger public contract

Capacity and units are positive safe integers. Reservations are idempotent by exact request payload,
conflicting replays fail without mutation, terminal transitions are idempotent, successful transitions
are durable before resolution, corrupt state fails closed, concurrent calls never oversubscribe, and
snapshots have stable ordering. Only `src/**` may be edited.
