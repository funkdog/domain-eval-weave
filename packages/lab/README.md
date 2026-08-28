# @domaineval/weave

DomainEval Weave turns provenance-bound domain truth into calibrated, replayable evaluations.

The package validates provenance-bound Claims and Requirements, calibrates versioned Evaluators against
Gold/equivalent/mutant cases, produces per-Claim Candidate Runs and replays frozen artifacts offline. It
does not require DSH, OAuth, an LLM Judge or network access.

```sh
domain-eval init ./capsule capsule-id domain.id owner-id
domain-eval doctor ./capsule
domain-eval show ./capsule
domain-eval validate ./capsule
domain-eval calibrate ./capsule evaluator@1.0.0
domain-eval run ./capsule requirement evaluator@1.0.0 candidate
```

Readiness progresses from `draft` to `runnable`, `qualified` and `publishable`. Calibration records bind the
exact release and Evaluator; they become stale rather than silently surviving source or evaluator changes.

The package is licensed Apache-2.0. Explicitly marked repository-authored synthetic source fixtures use
CC0-1.0; contributed Capsule sources retain their declared licenses. The source repository is available as a
public Developer Preview, while this npm package remains private until independent human clean-room evidence
supports Public Alpha.
