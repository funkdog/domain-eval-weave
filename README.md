# DSH Eval Lab

DSH Eval Lab is a DSH-native local plugin for measuring how one harness
intervention changes open-coding delivery under controlled conditions.

Phase 2 binds the first-party DSH Goal harness to a frozen three-bucket Task
Registry. It runs trigger, non-trigger, and holdout paired Campaigns and emits
replayable multi-task diagnostic evidence without a general uplift claim.

Phase 3 upgrades that trusted measurement kernel into requirements-delivery
evaluation. The active Phase 3A slice adds a separate domain-authoring plane:
adaptive domain interviews, provenance-bound product truth, requirement deltas,
and deterministic impact closure. It does not yet generate graders or run a
Semantic Judge.

## Canonical plans

- [Phase 1 product plan](docs/plans/2026-08-17-dsh-eval-lab-product-plan.md)
- [Phase 1 implementation spec](docs/plans/2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)
- [Phase 2 product plan](docs/plans/2026-08-18-dsh-eval-lab-phase-2-product-plan.md)
- [Phase 2 implementation spec](docs/plans/2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md)
- [Phase 3 product plan](docs/plans/2026-08-19-dsh-eval-lab-phase-3-product-plan.md)
- [Phase 3A implementation spec](docs/plans/2026-08-19-dsh-eval-lab-phase-3a-implementation-spec.md)

## Workspace boundary

- Source repository: `/Users/slipshod/AIBuild/dsh-eval-lab`
- Persistent runtime data: `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`
- OAuth reference lab: `/Users/slipshod/AIBuild/dsh-codex-oauth-lab` (read-only reference)

The runtime root is intentionally outside Git and has mode `0700`. Never put
OAuth credentials, DSH sessions, candidate workspaces, Oracle artifacts, or
campaign outputs in this repository.

## Product entry

Eval Lab is installed as a DSH bundle and has no standalone `dsh-eval` command.
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

# Owner authority stays on the management profile; the author Agent cannot call it.
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder domain confirm domain-eval evidence_card \
    candidates/card.json domain-owner
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder domain validate domain-eval \
    manifests/<snapshot-id>.json
```

The Phase 1 compatibility commands remain `run` and `report <campaign-id>` on
the `eval-clowder` profile. New Campaigns use the `clowder-ai` instance;
historical fixed-root Campaigns are accepted only for read-only replay.

## Current state

Phase 1 and Phase 2 Milestones 0–4 are complete. Phase 3A is the active implementation
contract. The local `0.3.0-alpha.1` candidate adds strict domain artifacts, immutable snapshot replay,
an isolated author Skill/profile, and a management-only confirmation ledger; it is not yet release-accepted.
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
```
