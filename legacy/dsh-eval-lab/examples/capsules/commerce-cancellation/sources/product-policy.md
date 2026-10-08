# Synthetic Commerce Cancellation Policy

A paid order may be cancelled before fulfillment begins. An accepted cancellation exposes `cancelled` as the
public order status. It requests one refund and repeating the same cancellation does not request another refund.

The product policy does not define a mandatory transport shape: throwing and returning a typed rejection or
success result are implementation choices unless a public API contract says otherwise.

Retention of cancellation audit records is required by an external policy, but this reference service currently
has no public retention observation.
