# DomainEval Weave

**Make domain truth executable.**

DomainEval Weave turns real-world sources and expert judgment into provenance-bound Claims,
versioned Evaluators and replayable Runs. It is designed for domain experts, maintainers and
evaluation engineers who need to answer three questions without relying on hidden prompt lore:

1. What domain truth has actually been confirmed, conflicted or left unknown?
2. What observable evidence makes an evaluator fair enough to use?
3. Can another person reproduce the result from the released artifacts alone?

The project is offline-first. Authoring, validation, calibration, comparison and replay do not
require DSH, OAuth credentials, model calls or network access.

## The evaluation asset

```text
Sources
  → Claims
  → Requirements
  → Gold / equivalent / mutant cases
  → calibrated Evaluator
  → Candidate Run
  → artifact-only replay
```

The contribution journey exposes five primary concepts:

- **Capsule** — the versioned container for one domain evaluation.
- **Claim** — a falsifiable statement bound to sources and explicit authority status.
- **Requirement** — the delivery behavior that uses or preserves Claims.
- **Evaluator** — observable checks calibrated against Gold, equivalent and mutant cases.
- **Run** — a content-addressed Candidate result that can be replayed without rerunning the Candidate.

`doctor` reports four non-numeric readiness stages: `draft`, `runnable`, `qualified` and
`publishable`. It never silently confirms Claims or repairs Evaluators.

## Packages

| Package | Responsibility |
| --- | --- |
| `@domaineval/weave` | Default Capsule, Evaluator, Harness, CLI and TypeScript API |
| `@domaineval/dsh-adapter` | Optional DSH Session, observation and TDD mechanism projection |
| `dsh-eval-lab` | Private historical DSH compatibility and replay package |

The main package has only `yaml` and `zod` as runtime dependencies. Its packed closure excludes
legacy DSH, Judge, Campaign and authoring implementations.

## Local preview

Requirements: Node.js 24 and pnpm 11.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @domaineval/weave build

CAPSULE_ROOT="$(mktemp -d)/returns-policy"
node packages/lab/bin/domain-eval.mjs init \
  "$CAPSULE_ROOT" returns-policy commerce.returns returns-owner
node packages/lab/bin/domain-eval.mjs doctor "$CAPSULE_ROOT"
node packages/lab/bin/domain-eval.mjs show "$CAPSULE_ROOT"
```

`init` creates a valid truth-empty draft. It does not invent sources, Claims or expected answers.

## Run the reference evaluation

The repository includes a fully synthetic Commerce cancellation Capsule. Copy it before running so
generated `.eval/` artifacts stay outside the source tree.

```sh
DEMO_ROOT="$(mktemp -d)"
cp -R packages/lab/dist/examples/commerce-cancellation "$DEMO_ROOT/capsule"

node packages/lab/bin/domain-eval.mjs validate "$DEMO_ROOT/capsule"
node packages/lab/bin/domain-eval.mjs calibrate \
  "$DEMO_ROOT/capsule" commerce-delivery@2.0.0
node packages/lab/bin/domain-eval.mjs compare \
  "$DEMO_ROOT/capsule" self-service-cancellation \
  commerce-delivery@1.0.0 commerce-delivery@2.0.0
```

Evaluator v1 intentionally false-rejects a behaviorally equivalent typed-result implementation.
Evaluator v2 repairs that error without changing the confirmed Domain Claims. The example demonstrates
why an evaluator version needs calibration evidence, not merely plausible checks.

## Contribute a Capsule

1. Initialize a truth-empty draft.
2. Add licensed sources with provenance descriptions.
3. Write Claims and keep unresolved, conflicted and unobservable truth explicit.
4. Obtain owner confirmation only from declared authority.
5. Bind a Requirement to the relevant Claims.
6. Add Gold, behaviorally equivalent and targeted mutant Candidates.
7. Calibrate and compare the exact Evaluator version.
8. Reach `publishable`, persist an accepted Run and replay it artifact-only.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution contract and
[the main package guide](packages/lab/README.md) for CLI commands.

## Trust boundaries

- Candidate code runs only through a supported fail-closed sandbox.
- Candidate code cannot read Capsule truth, cases, labels, releases or stored Runs.
- Missing sandbox support is measurement invalidity, never permission to run unsandboxed.
- Schema validity does not make a Claim true; domain authority and code review are separate.
- A single pair or a single Judge run cannot establish a general Harness uplift claim.
- Repository examples and tests use synthetic data only.

See the [platform support matrix](docs/support-matrix.md), [security policy](SECURITY.md) and
[governance model](GOVERNANCE.md).

## Release status

The implementation, license boundary and isolated public install/type workflow have current macOS/Ubuntu
evidence for the private Developer Preview candidate. Formal review and merge remain pending. Public Alpha
additionally requires an uninvolved human contributor to complete the label-free clean-room journey without
oral help.

Machine-readable status lives in [open-source-status.json](open-source-status.json). The Phase 4B
[product contract](docs/plans/2026-08-26-dsh-eval-lab-phase-4b-product-plan.md) and
[implementation contract](docs/plans/2026-08-26-dsh-eval-lab-phase-4b-implementation-spec.md) define the
current acceptance boundary.

## Historical lineage

DomainEval Weave grew from DSH Eval Lab's controlled Harness experiments and domain-delivery evaluation
work. Phase 1–4A plans and artifacts retain their original names and identities for audit and replay.
New users do not need the historical DSH runtime; the optional adapter preserves the integration boundary.

## License

Code, generated Schemas and repository-authored documentation are licensed under Apache-2.0.
Explicitly marked repository-authored synthetic source fixtures use CC0-1.0. Community Capsule sources
retain their own declared licenses.
