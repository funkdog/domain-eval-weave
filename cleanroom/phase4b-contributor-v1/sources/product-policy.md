# Synthetic customer return policy

A delivered consumer order is eligible for a self-service return when the request is submitted no later than
14 calendar days after `delivered_at`. Customized goods are outside this policy.

An accepted eligible request exposes public status `return_accepted` and requests exactly one refund. The
policy speaks about product outcomes; it does not require an exception, typed result or other transport
shape.
