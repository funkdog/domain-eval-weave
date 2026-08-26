# DSH Eval Lab

DSH Eval Lab turns provenance-bound domain truth into versioned evaluators and can use the same
evaluation asset to measure how one Harness intervention changes delivery under controlled conditions.

Phase 4B turns the runner-neutral baseline into one physically independent main package:

```text
Sources → Capsule → Evaluator → Candidate Evaluation → optional Harness Experiment
```

The primary user journey exposes only Capsule, Claim, Requirement, Evaluator and Run. DSH remains the
first high-integrity Harness experiment adapter; it is not required to author, validate, calibrate or replay
a Capsule.

```text
@dsh-eval/lab          default Capsule/Evaluator package
@dsh-eval/dsh-adapter  optional DSH and TDD evidence projection
dsh-eval-lab           private historical DSH compatibility package
```

## Offline quickstart

The synthetic Commerce reference needs no DSH profile, OAuth credential, model call, network access or
Judge. Copy it before running so generated `.eval/` artifacts stay outside the source tree.

```sh
pnpm install --frozen-lockfile
pnpm --filter @dsh-eval/lab build

CAPSULE_DEMO_ROOT="$(mktemp -d)"
cp -R packages/lab/dist/examples/commerce-cancellation "$CAPSULE_DEMO_ROOT/capsule"

node packages/lab/bin/dsh-eval-capsule.mjs validate "$CAPSULE_DEMO_ROOT/capsule"
node packages/lab/bin/dsh-eval-capsule.mjs calibrate \
  "$CAPSULE_DEMO_ROOT/capsule" commerce-delivery@2.0.0
node packages/lab/bin/dsh-eval-capsule.mjs compare \
  "$CAPSULE_DEMO_ROOT/capsule" self-service-cancellation \
  commerce-delivery@1.0.0 commerce-delivery@2.0.0
```

The v1 Evaluator intentionally false-rejects a valid typed-result implementation. The v2 comparison
demonstrates how a community evaluator can repair that error without changing the Domain Claims.

## Start a Capsule contribution

```sh
node packages/lab/bin/dsh-eval-capsule.mjs init \
  ./returns-policy returns-policy commerce.returns returns-owner
node packages/lab/bin/dsh-eval-capsule.mjs doctor ./returns-policy
node packages/lab/bin/dsh-eval-capsule.mjs show ./returns-policy
```

`init` creates a valid truth-empty draft—never fake Claims. `doctor` reports `draft`, `runnable`,
`qualified` or `publishable` plus stable next actions. Calibration records are content-addressed and bound
to the exact Capsule release, so source/Evaluator drift returns the Capsule to an earlier readiness stage.

## Historical DSH measurement kernel

Phase 2 binds the first-party DSH Goal harness to a frozen three-bucket Task
Registry. It runs trigger, non-trigger, and holdout paired Campaigns and emits
replayable multi-task diagnostic evidence without a general uplift claim.

Phase 3 upgrades that trusted measurement kernel into requirements-delivery
evaluation. Phase 3A adds a separate domain-authoring plane: adaptive domain
interviews, provenance-bound product truth, requirement deltas, deterministic
source/artifact handoff, and deterministic impact closure. The bounded Phase 3B
slice compiles confirmed Claims into one frozen deterministic ledger Grader,
calibrates it against Gold and risk-weighted mutants, runs the existing paired
Agent Campaign, and emits a replayable five-axis delivery report. Phase 3B.1 adds
one equally bounded commerce template for self-service order cancellation. Phase 3B.2 adds the
orthogonal fulfillment-withdrawal successor required for active-fulfillment cancellation, while
keeping payment/refund, inventory, coupon, ownership, idempotency, restart, audit, and retention
truths independently observable. It does not run a Semantic Judge or open a runtime template registry.
Phase 3C is the next bounded measurement successor: it replaces implementation-shaped deterministic
assertions with a domain observation normal form, adds separately calibrated Semantic and Code Quality
Judges, and emits Delivery, Semantic, Code Quality, and Harness Effect axes under one Measurement
Validity envelope. DSH development capabilities remain separate runtime products; Eval Lab only
ablates and observes them.

## Canonical plans

- [Phase 1 product plan](docs/plans/2026-08-17-dsh-eval-lab-product-plan.md)
- [Phase 1 implementation spec](docs/plans/2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)
- [Phase 2 product plan](docs/plans/2026-08-18-dsh-eval-lab-phase-2-product-plan.md)
- [Phase 2 implementation spec](docs/plans/2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md)
- [Phase 3 product plan](docs/plans/2026-08-19-dsh-eval-lab-phase-3-product-plan.md)
- [Phase 3A implementation spec](docs/plans/2026-08-19-dsh-eval-lab-phase-3a-implementation-spec.md)
- [Phase 3B implementation spec](docs/plans/2026-08-21-dsh-eval-lab-phase-3b-implementation-spec.md)
- [Phase 3B.1 commerce implementation spec](docs/plans/2026-08-21-dsh-eval-lab-phase-3b1-commerce-implementation-spec.md)
- [Phase 3B.2 commerce withdrawal implementation spec](docs/plans/2026-08-22-dsh-eval-lab-phase-3b2-commerce-withdrawal-implementation-spec.md)
- [Phase 3C product plan](docs/plans/2026-08-24-dsh-eval-lab-phase-3c-product-plan.md)
- [Phase 3C implementation spec](docs/plans/2026-08-24-dsh-eval-lab-phase-3c-implementation-spec.md)
- [Phase 4A product plan](docs/plans/2026-08-26-dsh-eval-lab-phase-4a-product-plan.md)
- [Phase 4A implementation spec](docs/plans/2026-08-26-dsh-eval-lab-phase-4a-implementation-spec.md)
- [Phase 4B product plan](docs/plans/2026-08-26-dsh-eval-lab-phase-4b-product-plan.md)
- [Phase 4B implementation spec](docs/plans/2026-08-26-dsh-eval-lab-phase-4b-implementation-spec.md)
- [Platform support matrix](docs/support-matrix.md)
- [Commerce experience acceptance guide](docs/guides/commerce-experience-acceptance.md)

## Workspace boundary

- Source repository: `/Users/slipshod/AIBuild/dsh-eval-lab`
- Persistent runtime data: `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`
- OAuth reference lab: `/Users/slipshod/AIBuild/dsh-codex-oauth-lab` (read-only reference)

The runtime root is intentionally outside Git and has mode `0700`. Never put
OAuth credentials, DSH sessions, candidate workspaces, Oracle artifacts, or
campaign outputs in this repository.

## Product entry

The Capsule baseline is available through the standalone local `dsh-eval-capsule` command. Historical
Campaigns and live Harness experiments continue to use the DSH bundle.
The Clowder implementation owns `eval-clowder` / `eval-clowder-runner`, instance
id `clowder-ai`, plus the Phase 3A authoring profile `eval-clowder-author`; it owns no
`eval` or `eval-dsh` state. Every supported DSH process
receives both isolation variables before boot:

`<DSH_HOME>/settings.yaml` is shared transport-control-plane input. It must
already select `openai-codex` / `gpt-5.6-sol` / `xhigh`; Eval Lab validates
those fields read-only and preserves all unrelated settings so `eval-dsh` can
coexist in the same DSH home.

```sh
umask 077
install -d -m 700 /Users/slipshod/AIBuild/dsh-eval-lab-runtime
install -d -m 700 /Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh plugin --profile eval-clowder add <local-checkout-or-built-tarball>
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder --help
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder init
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder auth status
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder auth login
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder doctor
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder calibrate
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder binding show
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder suite run
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder suite report <suite-id>

# Run the authoring Skill from the synthetic/product project being onboarded.
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder-author "/design-domain-grader onboard"

# Release forward acceptance uses the packaged AuthorForwardCarrier instead of
# admitting hand-selected directories from a direct author invocation.
# It accepts only managed synthetic fixture manifests under
# dsh-eval-lab-runtime/phase3a-forward-acceptance/fixtures and digest-named
# reviewed tarballs under phase3a-forward-acceptance/packages/<exact-revision>.
# Independent labels live outside the Author workspace under the managed labels root.
# Runtime-owned receipts bind both promotion attempts and final-artifact projections;
# the evaluator derives the complete admitted cohort directly from that evidence root.
# The production carrier freezes a managed rc.6 DSH launcher and verifies the live
# author profile installed bytes against the exact reviewed tar; launcher/verifier
# injection and lowering the three-run release minimum are not public inputs. A
# runtime capability repeats the same identity/content check immediately before
# launch and after exit, so the receipt cannot outlive the verified runtime bytes.

# Owner authority stays on the management profile; the author Agent cannot call it.
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder domain confirm domain-eval evidence_card \
    candidates/card.json domain-owner
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder domain validate domain-eval \
    manifests/<snapshot-id>.json

# Compile the confirmed Requirement, admit the frozen deterministic Grader,
# run the real two-arm Agent Campaign, and persist the five-axis report.
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder delivery run domain-eval \
    manifests/<snapshot-id>.json <requirement-id>
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder delivery report <campaign-id>

# The general-audience Commerce acceptance case is explicit; Reservation remains
# the backward-compatible default when --template is omitted.
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder delivery run domain-eval \
    manifests/<commerce-snapshot-id>.json self-service-order-cancellation \
    --template commerce-order-cancellation-v2
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder delivery report <campaign-id> \
    --template commerce-order-cancellation-v2

# Phase 3C artifact-only replay is available under the successor template.
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder delivery report <campaign-id> \
    --template commerce-order-cancellation-v3
```

The Phase 1 compatibility commands remain `run` and `report <campaign-id>` on
the `eval-clowder` profile. New Campaigns use the `clowder-ai` instance;
historical fixed-root Campaigns are accepted only for read-only replay.

## Current state

Phase 4B now builds an independent `@dsh-eval/lab` tarball containing only bundled Capsule/Evaluator/Harness
code, six schemas, CLI and the synthetic reference Capsule; its runtime dependencies are only `yaml` and
`zod`. A separate `@dsh-eval/dsh-adapter` owns raw Session, observation and TDD mechanism projection while
Phase 3C re-exports it for historical compatibility. Truth-empty `init`, non-mutating `doctor`, deterministic
`show` and content-addressed calibration records implement the draft→runnable→qualified→publishable journey.
The Candidate runner supports macOS sandbox-exec and Linux bubblewrap plans and fails closed elsewhere.
A packed clean consumer completes init, calibration, comparison, Candidate Run and replay without repository
source imports, DSH, OAuth or model calls. Open-source implementation readiness is green; Developer Preview
remains blocked on operator license selection, and Public Alpha additionally requires an independent human
clean-room contributor.

Phase 1 and Phase 2 Milestones 0–4 are complete. The Phase 3A Author forward slice and the
Reservation Phase 3B production vertical have completed isolated acceptance and independent replay;
neither result is presented as full Phase 3 completion. Phase 3B.1 is the bounded second-template
successor, and Phase 3B.2 is its orthogonal fulfillment-withdrawal template. All Delivery templates add explicit Claim observation bindings, deterministic Claim IR
and Oracle Plan compilation, actual Gold/red/mutant calibration admission, one production
`delivery run` entry, and a replayable report across Requirement Delta, Domain Preservation,
Semantic Residual, Measurement Validity, and Harness Impact. The release build physically omits trusted builder siblings;
replay revalidates the entire paired Campaign deployment and rebuilds the Oracle Plan from Claim IR plus
the frozen observation catalog. Its profile successor accepts only the exact accepted `6725a48` Phase 3B.2
management+runner+author package cohort. The Phase 3A `0.3.0-alpha.1` package adds strict domain artifacts, immutable snapshot replay,
an isolated author Skill/profile with an author-only `domain_artifact` helper, runtime-owned forward-run receipts and promotion-attempt
evidence, and a management-only confirmation ledger; it is not yet release-accepted.
The Phase 2 rc.4 release implements the
Milestone 0–4 code surfaces and adds
digest-closed Harness/Registry/Eval Pack binding, typed rc.6 Goal activation,
immutable exposure records, holdout first-exposure enforcement, blind six-Episode
Suite execution, Suite-scoped qualification provenance, and artifact-only
semantic Suite replay against frozen Sessions plus the immutable exposure ledger. The report preserves
per-task Outcome, Mechanism, Cost, and validity; it has no aggregate score,
effect claim, or automatic lifecycle action. The rc.4 Registry replaces the permanently reserved
`ledger-restart-recovery-v1` slot with the genuinely new `ledger-release-recovery-v1` holdout. Its
task id, public-task bytes, and effective-base bytes are all distinct; prior reservations and exposure
evidence remain immutable. Exact HEAD `fb15c7ef8ec34aeed4401ce82cc35ef5302f97f9`
completed release acceptance in Suite `suite-20260818092709-d1a5faa7`: one qualification,
six fresh Candidate Episodes, six externally verified outcomes, and byte-stable artifact-only replay.
The Suite retained holdout no-activation as paired insufficiency while keeping the bounded
multi-task diagnostic valid; it did not produce a general effect claim.

Phase 3C now implements the typed public Observation Catalog, total Authority Map compiler, closed
normal-form evaluator, exact Gold/equivalent/mutant calibration, isolated no-tools Judge runner,
freeze/unseal/admission protocol, independent Semantic and Code Quality contracts, four-axis report,
and artifact-only replay. The package does not vendor or emulate the external TDD Skill. On the
runtime checks the exact DSH Skill deployment before a new v3 Campaign and fails closed before
Candidate execution when it is missing; historical or externally produced v3 artifacts remain
replayable. Human-curated locked Judge holdouts and an exact verified Skill deployment are both
required before production acceptance can be claimed.

The operator gates are intentional: `auth login` must be invoked explicitly,
and any replacement for an already exposed holdout must be approved as a new
versioned Task before the real seven-call acceptance (one cached qualification
plus six Candidate Episodes). Eval Lab never opens,
copies, prints, moves, or hashes the OAuth credential.

## Development

Use Node 24 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm readiness:open-source
```
