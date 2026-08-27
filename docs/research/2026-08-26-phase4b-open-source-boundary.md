---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, capsule, open-source, packages, contributor-experience, acceptance]
doc_kind: research
created: 2026-08-26
description: "Phase 4B independent Lab/DSH adapter packages, Capsule contribution UX and open-source readiness evidence."
---

# Phase 4B open-source boundary evidence

## Outcome

Phase 4B implementation evidence is complete on top of Phase 4A `a92f559`. The default product is now a
physically independent `@dsh-eval/lab` package; DSH/TDD evidence lives in optional
`@dsh-eval/dsh-adapter`; the root `dsh-eval-lab` package remains private historical compatibility.

The implementation is not yet an open-source release. Developer Preview is blocked on operator license
selection and the first remote macOS/Ubuntu CI result. Public Alpha additionally requires an independent
human clean-room contribution.

## Package closures

| Package | Packed files | Runtime dependencies | Role |
| --- | ---: | --- | --- |
| `@dsh-eval/lab` | 57 | `yaml`, `zod` | Default Capsule/Evaluator/CLI |
| `@dsh-eval/dsh-adapter` | 12 | `@dsh-eval/lab`, `zod` | Optional DSH observation/TDD projection |
| `dsh-eval-lab` | 570 | DSH Session, `yaml`, `zod` | Private legacy production/replay |

Lab pack tests reject DSH, Phase 3C, Commerce Withdrawal, Task Pack, runtime profile, registry and authoring
paths. Installed Lab JS/declarations contain no repository absolute path or DSH Session import. The adapter
tar rewrites its workspace dependency to exact `@dsh-eval/lab@0.1.0-alpha.0`. The root legacy facade bundles
workspace implementations so historical tar installation does not require unpublished workspace packages.

## Contribution journey

`init` creates an atomic truth-empty draft with one declared owner and no fake sources, Claims,
Requirements, Evaluators, Candidates or cases. `doctor` projects stable action codes and four non-numeric
stages:

```text
draft → runnable → qualified → publishable
```

`show` produces deterministic Markdown. Exact-release calibration reports persist under
`.eval/calibrations/<sha256>.json`; a source, Candidate, Requirement, case or Evaluator change creates a new
release identity, so stale calibration does not silently preserve readiness.

A packed Lab tar was installed into a fresh temporary consumer. Only the installed binary was used to:

1. initialize and inspect a truth-empty draft;
2. copy the installed synthetic Commerce reference;
3. observe runnable readiness;
4. calibrate `commerce-delivery@2.0.0` to publishable;
5. compare v1/v2;
6. evaluate Gold to an accepted Run;
7. replay the persisted Run artifact-only.

No repository source API, DSH, OAuth, model call or network call was used after package installation.

## Human clean-room handoff

A separate label-free returns-policy kit now contains three CC0 synthetic sources, five opaque Candidate
programs, public file-shape guidance and a strict participant/observer receipt. It contains no Capsule,
Claims, Requirement, Evaluator, calibration expectations or Candidate labels. Materialization freezes the
exact Lab tar and every kit byte; verification requires a publishable submission, current qualified
calibration, accepted Run replay, all supplied sources/Candidates and distinct participant/observer ids.

The verifier reports only `mechanically_valid`; it cannot edit `open-source-status.json`. A synthetic positive
fixture tests the verifier in temporary runtime storage and is never accepted as human evidence. The actual
kit is materialized at `/Users/slipshod/AIBuild/dsh-eval-lab-runtime/phase4b-human-cleanroom-v1` with Lab
package SHA-256 `b39646bf6d7520b334c78951e13d3db9d711ce6c30804fa7e6573550ee53e6c5`.

## License decision evidence

Primary-source Apache/OSI/Creative Commons research is stored under
`project-research/2026-08-27-open-source-license-boundary/`. The recommendation is Apache-2.0 for code,
generated schemas and repository-authored docs; CC0-1.0 only for explicitly marked repository-authored
synthetic sources; community sources retain their declared license. This remains an operator decision and no
LICENSE file has been applied.

## Adapter ownership and compatibility

Raw DSH JSONL, Commerce normal-form conversion, TDD task/event schemas, frozen Skill binding and mechanism
projection are canonical in the adapter package. Phase 3C keeps a compatibility re-export and its existing
schemas/digests/tests remain unchanged. Lab imports neither adapter nor Phase 3C.

The private legacy bundle inlines workspace packages into its public runtime facades, preserving historical
DSH plugin installation while keeping the new public package closures disjoint.

## Platform contract

macOS Candidate execution retains sandbox-exec with explicit network and Capsule truth/label denials. Linux
plans use bubblewrap with `--unshare-all`, a read-only `/candidate`, writable `/scratch`, cleared environment
and no Capsule-root bind. Unsupported platforms or missing sandbox executables fail with
`CAPSULE_SANDBOX_UNAVAILABLE` before Candidate execution.

Linux planning is contract-tested locally; actual Ubuntu bubblewrap execution remains pending the first
GitHub-hosted CI run. Windows is explicitly unsupported for Phase 4B.

## Governance and readiness

The repository now includes contribution, security, conduct, governance, platform-support and CI contracts.
The CI workflow uses Node 24 on macOS and Ubuntu, installs bubblewrap on Linux and runs static checks, all
tests, all package builds and readiness reporting.

Machine-readable status is currently:

```text
implementation_ready      true
developer_preview_ready   false
public_alpha_ready        false
blockers                  LICENSE_UNSELECTED, REMOTE_CI_PENDING, HUMAN_CLEANROOM_PENDING
```

The automated packed consumer is implementation evidence, not a substitute for an uninvolved person.

## Verification

- TypeScript strict compile: pass;
- Biome: pass with the pre-existing broken `cat-cafe-skills` symlink warning;
- full historical + Phase 4B suite: 393/393 pass;
- root legacy build/pack/import: pass;
- Lab and adapter build/pack closure: pass;
- packed Lab clean consumer: pass;
- regenerated six public schemas: pass;
- source/runtime artifact scan: zero findings;
- Git diff whitespace gate: pass.

## Remaining external decisions

1. Select code and Capsule-data licenses, then add LICENSE files and update package metadata.
2. Configure a repository remote, push the branch and obtain the first real macOS/Ubuntu CI result. A local
   Node 24 Linux container attempt could not pull the official image because Docker Hub timed out; existing
   local Linux images contain only Node 20, so no Linux execution claim was made.
3. Run M5 with an uninvolved human contributor without oral help.
4. Only after those gates change the main package from private and announce Developer Preview/Public Alpha.
