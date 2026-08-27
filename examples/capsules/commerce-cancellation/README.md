# Commerce Cancellation Capsule

This synthetic Capsule demonstrates the Phase 4A public journey without DSH, OAuth, a model call, or a Judge.

```sh
domain-eval validate examples/capsules/commerce-cancellation
domain-eval release examples/capsules/commerce-cancellation
domain-eval calibrate examples/capsules/commerce-cancellation commerce-delivery@1.0.0
domain-eval calibrate examples/capsules/commerce-cancellation commerce-delivery@2.0.0
domain-eval compare examples/capsules/commerce-cancellation self-service-cancellation \
  commerce-delivery@1.0.0 commerce-delivery@2.0.0
```

Evaluator v1 intentionally rejects the valid `equivalent-typed-result` Candidate because it constrains transport
shape. Evaluator v2 removes that implementation-shaped check while preserving the three domain Claims.
