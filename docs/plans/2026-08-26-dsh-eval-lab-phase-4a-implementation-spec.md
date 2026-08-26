---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, capsule, evaluator-engine, open-source-baseline, harness-effect]
doc_kind: implementation-spec
created: 2026-08-26
description: "DSH Eval Lab Phase 4A 实施合同：Capsule v0、通用 Evaluator Engine、离线 Commerce reference journey 与 DSH adapter。"
---

# DSH Eval Lab Phase 4A 实施合同

## 1. 范围

Phase 4A 在 Phase 3C candidate `de1e2a6` 上建立 successor surface，不删除历史实现。实施顺序固定为：

```text
public contract classification
→ Capsule v0 loader/release
→ Evaluator Engine
→ offline Commerce Capsule
→ evaluator comparison
→ DSH adapter boundary
→ clean-room acceptance
```

## 2. 代码边界

```text
src/capsule/             public Capsule contracts, loader, release and replay
src/evaluator/           evaluator compiler, command adapter, calibration and comparison
src/harness/             runner-neutral paired projection
src/capsule-cli/         contributor-facing CLI
examples/capsules/       public reference Capsules
contracts/capsule/       generated public JSON schemas only
```

Existing `src/phase3c`, domain template stacks and DSH carrier remain compatibility/optional modules. Capsule core cannot import
`@deepseek-ai/dsh-session`, DSH profiles, Phase 3C Judge code, Commerce production modules or OAuth/auth facilities.

## 3. Public contracts

Only the following top-level schemas are public-core:

1. `capsule-manifest`;
2. `domain-contract`;
3. `requirement-delta`;
4. `evaluator-package`;
5. `calibration-case`;
6. `evaluation-run`.

### 3.1 Capsule Manifest

The manifest binds normalized relative paths for domain, requirements, evaluators, candidates, cases and source files. Source files include
`source_id`, `kind`, `path` and optional license/provenance note. Paths must be physical, stay inside Capsule root and reject symlink escape.

### 3.2 Domain Contract

Claims contain id, statement, applicability, status, source ids, risk and optional confirmation. Confirmed claims require an explicit owner
listed by the domain. Conflicted claims require at least two conflict source ids. Non-confirmed claims cannot carry confirmation.

### 3.3 Requirement Delta

Each edge is one of `uses/preserves/introduces/modifies/deprecates/conflicts_with`. All referenced Claims must exist. Hard evaluation closure
contains required `uses/preserves` Claims plus confirmed requirement-scoped Claims; unconfirmed required Claims remain inconclusive.

### 3.4 Evaluator Package

Evaluator checks bind one Claim and use a closed v0 algebra:

- `exit_code_equals`;
- `json_path_equals`;
- `json_array_count_equals`.

Each Candidate command runs once and must emit one JSON document on stdout. The engine records exit code/stdout/stderr digests internally;
only the normalized observation document and diagnostics enter the public Run.

### 3.5 Calibration Case

Each case binds a Candidate and declares `gold/equivalent/mutant`. Expectations are per Evaluator version and per Claim. Calibration fails if
an expected entry is missing, if an unexpected hard verdict is produced, or if a mutant's declared target Claims are not failed.

### 3.6 Evaluation Run

The Run contains exact Capsule release SHA, Evaluator identity/version, Candidate identity, Requirement identity, per-Claim status,
measurement validity and evidence locators. Overall verdict is `accept/reject/inconclusive`; no score exists.

## 4. Generated release lock

`capsule release` validates all public inputs, hashes exact physical bytes and writes `.eval/releases/<release-sha>.json` using exclusive-create.
The release contains normalized path/digest entries and derived Claim dependency edges. Contributors never edit it.

Replay reads only the release closure and stored Runs, rejects missing/extra referenced files and never invokes Candidate commands.

## 5. Contributor CLI

The standalone local CLI supports:

```text
validate <capsule-root>
confirm <capsule-root> <claim-id> <owner-id>
release <capsule-root>
run <capsule-root> <requirement-id> <evaluator-id>@<version> <candidate-id>
calibrate <capsule-root> <evaluator-id>@<version>
compare <capsule-root> <requirement-id> <left-evaluator> <right-evaluator>
replay <capsule-root> <run-ref>
```

The CLI must not boot DSH or read ambient credentials. User errors identify editable file and object id.

## 6. Command runner

Candidate commands execute with:

- Capsule/Candidate root read-only in intent;
- dedicated `.eval/tmp` scratch;
- network denied when the host sandbox is available;
- sanitized environment;
- fixed timeout and output cap;
- one canonical JSON stdout document;
- no access to expected calibration outcomes beyond public Candidate files.

Cross-platform hosts may provide a process adapter; absence of a supported sandbox is explicit measurement invalidity, not Candidate failure.

## 7. Commerce reference Capsule

The Capsule contains at least:

- three confirmed Claims;
- one proposed Claim;
- one unresolved or conflicted Claim;
- one observability gap;
- one cancellation Requirement;
- one Gold, two equivalent and three mutant Candidates;
- Evaluator v1 with one intentional known validity defect;
- Evaluator v2 that fixes it.

The reference release and Runs contain only synthetic data and are safe to commit.

## 8. Harness adapter boundary

Phase 4A defines a runner-neutral `HarnessExperiment` projection over two Candidate Evaluations plus activation/cost evidence. The DSH adapter
may reuse existing Session/Campaign machinery, but Capsule core cannot depend on it. Required invariants:

- same Capsule release and Evaluator for both arms;
- distinct frozen Candidates;
- exact intervention declaration;
- no arm label in Evaluator input;
- Candidate verdicts remain unchanged by paired projection;
- one pair yields only `descriptive` claim strength.

Unadmitted optional Judges make their axes inconclusive and do not block deterministic Delivery/Harness projection.

## 9. Migration and compatibility

Current contracts are classified as `public-core`, `internal-runtime`, `optional-research` or `legacy-replay`. Phase 4A adds adapters where needed;
it does not rewrite or delete historical artifacts. No new domain may copy the Commerce production stack.

## 10. Required tests

- strict schemas and unknown-field rejection;
- path traversal, symlink and duplicate-id rejection;
- source digest drift rejection;
- Claim status/confirmation/conflict semantics;
- Requirement reference and hard-closure semantics;
- confirmed-only hard checks;
- unconfirmed and observability-gap inconclusive projection;
- command timeout/output/schema failure as measurement error;
- Gold/equivalent/mutant calibration;
- Evaluator v1/v2 per-Claim comparison;
- release exclusive-create and artifact-only replay;
- command adapter and DSH adapter output compatibility;
- paired Candidate/Harness verdict independence;
- packed production import and source-tree cleanliness;
- historical test suite regression.

## 11. Milestones

### M0 — Product and contract classification

Freeze Phase 4A plans, six public schemas and the compatibility map.

### M1 — Capsule core

Loader, semantic validation, release lock and replay.

### M2 — Evaluator engine

Command adapter, closed check algebra, Candidate Evaluation, calibration and compare.

### M3 — Reference Capsule

Offline Commerce journey with Gold/equivalent/mutants and v1/v2 evaluator delta.

### M4 — Harness boundary

Runner-neutral paired projection and one bounded DSH adapter vertical.

### M5 — Clean-room acceptance

An uninvolved user completes the documented contribution and comparison journey without source reading or oral help.

## 12. Completion gate

- M0–M5 complete;
- fresh clone offline replay succeeds without DSH/OAuth/model calls;
- only five concepts appear in the primary user journey;
- contributors do not author generated identities/digests/receipts;
- Evaluator v2 improves declared calibration behavior without breaking equivalents;
- one DSH Harness report consumes the same exact Capsule/Evaluator closure;
- strict TypeScript, lint, tests, build, pack and source-tree cleanliness pass;
- no runtime artifact or secret exists in source.
