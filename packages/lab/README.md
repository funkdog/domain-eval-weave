# @dsh-eval/lab

Runner-neutral Domain Evaluation Capsules and deterministic evaluator engine.

The package validates provenance-bound Claims and Requirements, calibrates versioned Evaluators against
Gold/equivalent/mutant cases, produces per-Claim Candidate Runs and replays frozen artifacts offline. It
does not require DSH, OAuth, an LLM Judge or network access.

```sh
dsh-eval-capsule init ./capsule capsule-id domain.id owner-id
dsh-eval-capsule doctor ./capsule
dsh-eval-capsule show ./capsule
dsh-eval-capsule validate ./capsule
dsh-eval-capsule calibrate ./capsule evaluator@1.0.0
dsh-eval-capsule run ./capsule requirement evaluator@1.0.0 candidate
```

Readiness progresses from `draft` to `runnable`, `qualified` and `publishable`. Calibration records bind the
exact release and Evaluator; they become stale rather than silently surviving source or evaluator changes.

This package remains private until the repository's code and Capsule-data licenses are selected.
