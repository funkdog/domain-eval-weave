---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, capsule, evaluator-engine, harness-effect, acceptance]
doc_kind: research
created: 2026-08-26
description: "Phase 4A Capsule v0 implementation and bounded live DSH vertical evidence."
---

# Phase 4A Capsule v0 baseline evidence

## Outcome

Phase 4A now has an implementation candidate for the public thin waist:

```text
Sources → Capsule → Evaluator → Candidate Evaluation → optional Harness Experiment
```

The source package exposes six public Capsule schemas, one standalone offline CLI, a closed deterministic
Evaluator algebra, content-addressed release and Run replay, calibration and Evaluator comparison, plus a
runner-neutral Harness projection. Historical DSH and Judge stacks remain compatibility or research
surfaces rather than contributor prerequisites.

The baseline is not yet product-complete. Milestones M0–M4 have implementation evidence; M5 still requires
an uninvolved human to complete the documented contribution and comparison journey without source reading
or oral help.

## Offline reference result

The synthetic Commerce Capsule contains confirmed, proposed, conflicted and observability-gap Claims,
one Requirement, two Evaluator versions, Gold/equivalent cases and targeted mutants. Evaluator v1
intentionally false-rejects one typed-result equivalent. Evaluator v2 repairs that error and rejects the
status, double-refund, repeat-refund and replay-unavailable mutants.

A packed tarball was installed into an empty temporary consumer project. From the installed package, the
consumer validated and compared the copied reference Capsule without DSH, OAuth, a model call or repository
source imports. The only v1→v2 hard delta was the declared typed-result false reject changing from fail to
pass.

## Bounded live DSH vertical

The live evidence root is outside Git:

`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/phase4a-live.zBYgy9/result`

Both arms used the same bounded public task, synthetic candidate base, released Capsule
`850cd81de7a1d742b3eff3d19579376032fb34838276832319d9997327350383`, Requirement
`self-service-cancellation` and Evaluator `commerce-delivery@2.0.0`. Candidate content was frozen by a
physical closure fingerprint after the DSH process exited; Session JSONL bytes were independently hashed.

| Evidence | Control | Treatment |
| --- | --- | --- |
| DSH Session | `session-cd558ddf-36d0-4ccc-8d98-1c09557a9b80` | `session-640e1b0f-b393-41ea-b170-b6600da409a1` |
| Candidate SHA-256 | `8f172ce24b3a4e7a582731424cbb2487cd48c421f7b96a4219ffcf9bfc0c4cb3` | `ba186551daa20367530bde79f1f26156538ae51f978c30a68393bf254374b61a` |
| Elapsed | 210,294 ms | 234,319 ms |
| Candidate verdict | reject | reject |
| TDD activation | not activated | activated |
| TDD mechanism validity | valid | insufficient |

Per-Claim results were identical in both arms:

- `cancel-status`: pass;
- `refund-exactly-once`: pass;
- `cancellation-idempotent`: fail.

The idempotency failure is deliberately fail-closed. The Phase 3C observation runner could execute the
paid/unstarted cancellation scenario, but the bounded Candidate exposed no accepted replay operation. An
earlier Evaluator revision only counted repeat refund effects and would have incorrectly accepted an
unavailable replay. The vertical added an explicit `repeat.status == replayed` check and a
`mutant-replay-unavailable` calibration case before producing the final Runs.

Treatment loaded the declared TDD Skill, but raw typed evidence showed no focused red, focused green or
final full-suite green sequence, and the first test-file write occurred after a production write. The paired
report therefore has `mechanism_validity=insufficient`, `effect=inconclusive` and
`claim_strength=descriptive`. Candidate verdicts remain independent from the Harness projection. Elapsed
cost delta is +24,025 ms; token deltas are `null` because these Session transcripts do not expose trustworthy
usage fields.

The persisted replay anchors are:

- control Run: `.eval/runs/4175ea50dea0b723dd4cc3b4ebf00bbf64895d56532d9a21aa2b38228fb22166.json`;
- treatment Run: `.eval/runs/fdf67957f3f53f2935845aa8dcf25997e45377a6fcacb09c612baecf11c8b817.json`;
- paired projection: `harness-report.json`;
- exact provenance: `projection-summary.json`.

## Failed attempts and what they mean

Two full-scope treatment attempts ended in a DSH WebSocket transport error after partial model work. They
were retained under the runtime root and were not paired with the successful control, because transport
failure is invalid measurement rather than Candidate failure. The vertical was then narrowed to the
predeclared cancellation/replay Claims so that both arms could complete on the same scope.

The first bounded projection attempted to reuse the historical Git-tree Candidate freezer. The isolated DSH
workspaces were physical copies without `.git`, so that attempt stopped before Candidate Evaluation and is
recorded as `attempt-non-git-freeze-failed`. The successor used the existing physical package-content
fingerprint, which rejects symlinks and special entries and excludes `node_modules`; it did not initialize a
fake repository or fabricate Git provenance.

These failures explain why the live work took multiple rounds: each round closed a different validity gap
(transport parity, observation completeness, then Candidate identity) rather than rerunning until a favorable
score appeared.

## Remaining acceptance gate

M5 is intentionally human rather than another repository test. An uninvolved maintainer must be able to copy
the packaged example, trace a Claim to its sources, add or update a source/Claim/Requirement/mutant, compare
two Evaluator versions and replay a stored Run using only public documentation. Until that succeeds, the
implementation is a verified candidate, not an open-source product acceptance.
