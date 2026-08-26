# Commerce Cancellation Capsule

This synthetic Capsule demonstrates the Phase 4A public journey without DSH, OAuth, a model call, or a Judge.

```sh
dsh-eval-capsule validate examples/capsules/commerce-cancellation
dsh-eval-capsule release examples/capsules/commerce-cancellation
dsh-eval-capsule calibrate examples/capsules/commerce-cancellation commerce-delivery@1.0.0
dsh-eval-capsule calibrate examples/capsules/commerce-cancellation commerce-delivery@2.0.0
dsh-eval-capsule compare examples/capsules/commerce-cancellation self-service-cancellation \
  commerce-delivery@1.0.0 commerce-delivery@2.0.0
```

Evaluator v1 intentionally rejects the valid `equivalent-typed-result` Candidate because it constrains transport
shape. Evaluator v2 removes that implementation-shaped check while preserving the three domain Claims.
