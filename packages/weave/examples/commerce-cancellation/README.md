# Commerce Cancellation Capsule

This synthetic Capsule demonstrates the Phase 4A public journey without DSH, OAuth, a model call, or a Judge.

```sh
domain-eval validate packages/weave/examples/commerce-cancellation
domain-eval release packages/weave/examples/commerce-cancellation
domain-eval calibrate packages/weave/examples/commerce-cancellation commerce-delivery@1.0.0
domain-eval calibrate packages/weave/examples/commerce-cancellation commerce-delivery@2.0.0
domain-eval compare packages/weave/examples/commerce-cancellation self-service-cancellation \
  commerce-delivery@1.0.0 commerce-delivery@2.0.0
```

Evaluator v1 intentionally rejects the valid `equivalent-typed-result` Candidate because it constrains transport
shape. Evaluator v2 removes that implementation-shaped check while preserving the three domain Claims.
