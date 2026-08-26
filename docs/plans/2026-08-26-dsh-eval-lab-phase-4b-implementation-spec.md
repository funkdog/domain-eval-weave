---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, capsule, open-source, package-boundary, contributor-experience]
doc_kind: implementation-spec
created: 2026-08-26
description: "DSH Eval Lab Phase 4B 实施合同：物理 Lab/DSH adapter 分包、贡献者 CLI、跨平台 runner 与开源门禁。"
---

# DSH Eval Lab Phase 4B 实施合同

## 1. 基线与顺序

Phase 4B 基于 Phase 4A candidate `a92f559`，固定实施顺序：

```text
contracts
→ independent Lab package
→ contribution UX
→ DSH adapter/TDD ownership
→ platform/governance gates
→ packed clean-room acceptance
```

## 2. Repository layout

```text
packages/lab/                 @dsh-eval/lab package facade/build/contracts/examples
packages/dsh-adapter/         @dsh-eval/dsh-adapter package facade/build
src/capsule/                  canonical core implementation during 4B migration
src/evaluator/
src/harness/
src/adapters/                 compatibility re-exports only after extraction
src/phase3c/                  legacy/research compatibility
```

Phase 4B may bundle canonical root source into independent package artifacts to avoid duplicating implementation. The packed closure, dependency
graph and public exports—not source folder aesthetics—are the release boundary. Root `dsh-eval-lab` remains private legacy compatibility.

## 3. `@dsh-eval/lab` artifact contract

The package must expose:

```text
@dsh-eval/lab
@dsh-eval/lab/capsule
@dsh-eval/lab/evaluator
@dsh-eval/lab/harness
@dsh-eval/lab/cli
dsh-eval-capsule binary
```

Allowed runtime dependencies are `yaml`, `zod` and Node built-ins. Packed files are allowlisted to package metadata, README, bin, bundled JS,
declarations, six schemas and reference/template assets. Pack tests reject DSH, Judge, legacy contract/task/profile names and external source
references in emitted JS/declarations.

## 4. Draft-compatible contracts

Capsule manifest source/requirement/evaluator/candidate/case arrays and Domain Claim arrays may be empty for a draft. Owners remain explicit.
Release may freeze a draft, but run/calibrate/compare require their exact referenced faces. Existing complete Capsules remain byte-semantically
compatible after regenerated schemas.

## 5. Readiness projection

`inspectCapsuleReadiness` returns:

```text
stage: draft | runnable | qualified | publishable
truth: facts + blockers
evaluation: facts + blockers
release: facts + blockers
next_actions: stable action codes with file/object locators
```

No numeric score exists. Qualified status is derived only from a persisted content-addressed calibration report bound to exact release and
Evaluator identity. Publishable additionally requires declared source licenses/provenance and no required Claim blocker.

## 6. Contributor commands

Phase 4B adds:

```text
init <root> <capsule-id> <domain-id> <owner-id>
doctor <root> [evaluator-id@version]
show <root> [--json]
```

`init` uses exclusive-create and never overwrites a non-empty target. It creates a valid draft with no fake Claims or placeholder truth.
`doctor` is non-mutating. `show` renders a deterministic Markdown summary and optionally structured JSON. Existing commands remain stable.

## 7. Calibration persistence

Successful or failed calibration writes `.eval/calibrations/<sha256>.json` by exclusive-create. The record binds release SHA, Evaluator identity,
case outcomes and qualified boolean. Replay/doctor reject digest drift and stale records. Calibration labels never enter Candidate execution.

## 8. DSH adapter extraction

`@dsh-eval/dsh-adapter` owns raw JSONL projection, Commerce observation normalization and TDD task/event/mechanism projection. Phase 3C may
re-export the same implementation for compatibility; the adapter must not import `src/phase3c`. Lab must not import the adapter.

## 9. Runner adapters

Runner selection is explicit and injectable for tests. macOS sandbox-exec and Linux bubblewrap produce the same CandidateExecution face.
Supported adapters deny network and ambient home/config reads. Missing executable/platform returns `CAPSULE_SANDBOX_UNAVAILABLE` before
Candidate code runs.

## 10. Governance artifacts

Phase 4B adds CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, GOVERNANCE, package support matrix and CI workflow. LICENSE content is not inferred;
until operator selects code/data licenses, open-source readiness remains blocked with one explicit diagnostic.

## 11. Tests

- Lab tar contains only allowlisted files/dependencies and imports from an empty consumer;
- Lab JS/declarations contain no DSH/Phase3C/legacy source references;
- draft init is exclusive, deterministic and contains no fake truth;
- doctor stage transitions and action codes are exact;
- show output is deterministic and human-readable;
- calibration record is content-addressed, replayable and stale-aware;
- macOS/Linux runner plans deny network/truth and unsupported hosts fail closed;
- DSH adapter owns TDD projection while Phase 3C compatibility tests remain green;
- historical 382-test regression remains green;
- source and packed artifacts contain no runtime data or secrets.

## 12. Milestones

### M0 — Contracts

Freeze Phase 4B product/implementation plans and repository package ownership.

### M1 — Independent Lab

Build and consume a no-DSH `@dsh-eval/lab` tarball.

### M2 — Contribution UX

Draft-compatible contracts, init/doctor/show and persisted calibration readiness.

### M3 — DSH adapter boundary

Extract raw/TDD/observation ownership and retain Phase 3C compatibility re-exports.

### M4 — Platform and governance

macOS/Linux fail-closed runners, governance files, CI and explicit license gate.

### M5 — Acceptance

Fresh temporary consumer installs only Lab, initializes a Capsule, advances it through the documented readiness path, calibrates, compares and
replays without repository source imports, DSH, OAuth, model calls or network.

## 13. Completion gate

- M0–M5 implementation evidence complete;
- root legacy regression remains green;
- Lab/adapter package closures are disjoint from legacy/research;
- package/source trees are clean;
- license selection and human clean-room remain honestly reported external gates where unresolved.
