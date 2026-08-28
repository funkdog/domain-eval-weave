---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, domain-eval-weave, capsule, open-source, packages, contributor-experience, acceptance]
doc_kind: research
created: 2026-08-26
description: "DomainEval Weave Phase 4B package boundary, Capsule contribution UX and open-source readiness evidence."
---

# DomainEval Weave Phase 4B open-source boundary evidence

## Outcome

Phase 4B implementation evidence is complete on top of Phase 4A `a92f559`. After the operator-approved
2026-08-27 brand transition, the default product is a physically independent `@domaineval/weave` package;
DSH/TDD evidence lives in optional `@domaineval/dsh-adapter`; the root `dsh-eval-lab` package remains
private historical compatibility.

The operator approved Apache-2.0 code/docs plus CC0-1.0 repository-authored synthetic sources on 2026-08-27.
After formal review, merge and protected-main CI, the repository became a public Developer Preview on
2026-08-28. Public Alpha additionally requires an independent human clean-room contribution; npm packages
remain private until that evidence is accepted.

## Package closures

| Package | Packed files | Runtime dependencies | Role |
| --- | ---: | --- | --- |
| `@domaineval/weave` | 59 | `yaml`, `zod` | Default Capsule/Evaluator/CLI |
| `@domaineval/dsh-adapter` | 13 | `@domaineval/weave`, `zod` | Optional DSH observation/TDD projection |
| `dsh-eval-lab` | 573 | DSH Session, `yaml`, `zod` | Private legacy production/replay |

Lab pack tests reject DSH, Phase 3C, Commerce Withdrawal, Task Pack, runtime profile, registry and authoring
paths. Installed Lab JS/declarations contain no repository absolute path or DSH Session import. The adapter
tar rewrites its workspace dependency to exact `@domaineval/weave@0.1.0-alpha.0`. The root legacy facade bundles
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
fixture tests the verifier in temporary runtime storage and is never accepted as human evidence. The
DomainEval Weave kit is materialized at
`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/phase4b-human-cleanroom-domain-eval-weave-v1` with package
SHA-256 `958d33bd46415eb664d3b145dea1ab63005e7b6e7838750752f74ad7c691f1db`. Earlier package identities remain
preserved as superseded evidence and cannot satisfy the current clean-room gate.

The kit also contains `package/verifier-runtime.cjs`, bundled from that exact tarball during materialization.
Verification checks every kit byte before loading this runtime, so readiness, calibration and replay semantics
cannot silently come from a newer or stale repository checkout. The pre-runtime kit is preserved at
`phase4b-human-cleanroom-domain-eval-weave-v1-pre-verifier-runtime-superseded` and is not current evidence.

## License decision evidence

Primary-source Apache/OSI/Creative Commons research is stored under
`docs/research/2026-08-27-open-source-license-boundary/`. The recommendation is Apache-2.0 for code,
generated schemas and repository-authored docs; CC0-1.0 only for explicitly marked repository-authored
synthetic sources; community sources retain their declared license. The operator approved this boundary on
2026-08-27. Exact ASF license text is now present at the repository, Lab package and adapter package roots;
package metadata matches, and the Commerce synthetic source directory is explicitly marked CC0-1.0.

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

Ubuntu ran the 38-test portable DomainEval suite with the installed bubblewrap adapter, including packed
consumer calibration/replay and clean-room verification. macOS ran the complete 397-test historical plus
DomainEval regression. Both jobs passed for exact candidate `96c204e30106a75ec4e4876bee7c03b0eca8c04d`
in [GitHub Actions run 33057160390](https://github.com/funkdog/domain-eval-weave/actions/runs/33057160390).
Windows is explicitly unsupported for Phase 4B.

## Governance and readiness

The repository now includes contribution, security, conduct, governance, platform-support and CI contracts.
The CI workflow uses Node 24 on macOS and Ubuntu, installs bubblewrap on Linux and runs static checks, all
tests, all package builds and readiness reporting.

The earlier `96c204e` candidate established the first remote platform evidence. Public-repository
simplification candidate `8345fbb55264325a133301b561a6352a1e9bfa7b` then removed the fixed maintainer
runtime path and changed the workflow to one portable public gate. Both jobs passed in
[GitHub Actions run 33071721465](https://github.com/funkdog/domain-eval-weave/actions/runs/33071721465):
macOS in 1m00s and Ubuntu with real bubblewrap in 1m05s.

Formal review then found that root `pnpm install` still invoked the legacy `prepare` lifecycle and that
`pnpm lint` still type-checked the full legacy tree. The current candidate skips root lifecycle scripts during
public installation, explicitly rebuilds `esbuild`, builds only the two public packages and uses a dedicated
public TypeScript project. Exact candidate `2fef67e7ed0199b57212f27e30fedda349ecae94` passed
[GitHub Actions run 33072952107](https://github.com/funkdog/domain-eval-weave/actions/runs/33072952107)
on macOS and Ubuntu. Both Install logs contain `--ignore-scripts`; neither contains root `prepare`,
`clean-dist`, `bundle-delivery` or `tsconfig.test` execution.

Machine-readable status for the current candidate is:

```text
implementation_ready      true
developer_preview_ready   true
public_alpha_ready        false
blockers                  HUMAN_CLEANROOM_PENDING
```

The automated packed consumer is implementation evidence, not a substitute for an uninvolved person.

## Verification

- TypeScript strict compile: pass;
- Biome: pass without repository-internal symlink warnings;
- full historical + Phase 4B suite: 399/399 pass locally;
- public DomainEval suite and independent public type gate: pass locally and on hosted macOS/Ubuntu;
- root legacy build/pack/import: pass;
- root legacy JavaScript and declarations contain no unresolved DomainEval workspace imports;
- Lab and adapter build/pack closure: pass;
- packed Lab clean consumer: pass;
- regenerated six public schemas: pass;
- source/runtime artifact scan: zero findings;
- Git diff whitespace gate: pass.

## Remaining external decisions

1. Run M5 with an uninvolved human contributor without oral help, using the public Developer Preview.
2. After Public Alpha evidence, decide whether to remove `private: true` and publish the npm packages.

## Repository ownership migration

The current candidate moves the actual Weave implementation and six public Schemas into `packages/weave`,
renames the former `packages/lab` facade, and folds license research into `docs/research`. Root legacy package
compatibility is produced from Weave source at build time and remains covered by the complete historical
regression. Exact candidate `30bdac1531a8e11f887516e9c4290500aababf47` passed
[GitHub Actions run 33138395432](https://github.com/funkdog/domain-eval-weave/actions/runs/33138395432)
on macOS and Ubuntu; the public suite contains 41 tests and the complete historical suite contains 400.
