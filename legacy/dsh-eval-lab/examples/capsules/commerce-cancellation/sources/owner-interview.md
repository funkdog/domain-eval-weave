# Synthetic Owner Interview

## Successful case

The owner confirms that cancelling a paid, unfulfilled order leaves the customer-visible status as `cancelled`,
requests one refund, and remains idempotent when retried.

## Open policy

The exact customer-facing reason copy has not been approved. Support and product currently use different text.

## Conflict

The fulfillment team says active fulfillment must first be withdrawn; an older support document still says an
active order can be cancelled immediately. This policy remains conflicted and is outside the current requirement.

## Observation gap

The owner confirms that audit retention matters, but no public API or approved observer currently exposes it.
