# DSH Eval Lab

DSH Eval Lab is a DSH-native local plugin for measuring how one harness
intervention changes open-coding delivery under controlled conditions.

Phase 2 binds the first-party DSH Goal harness to a frozen three-bucket Task
Registry. It runs trigger, non-trigger, and holdout paired Campaigns and emits
replayable multi-task diagnostic evidence without a general uplift claim.

## Canonical plans

- [Product plan](docs/plans/2026-08-17-dsh-eval-lab-product-plan.md)
- [Phase 1 implementation spec](docs/plans/2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)
- [Phase 2 implementation spec](docs/plans/2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md)

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
id `clowder-ai`, and no `eval` or `eval-dsh` state. Every supported DSH process
receives both isolation variables before boot:

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
```

The Phase 1 compatibility commands remain `run` and `report <campaign-id>` on
the `eval-clowder` profile. New Campaigns use the `clowder-ai` instance;
historical fixed-root Campaigns are accepted only for read-only replay.

## Current state

Phase 1 Milestones 0–4 and Phase 2 Milestones 0–4 are implemented. Phase 2 adds
digest-closed Harness/Registry/Eval Pack binding, typed rc.6 Goal activation,
immutable exposure records, holdout first-exposure enforcement, blind six-Episode
Suite execution, and artifact-only semantic Suite replay. The report preserves
per-task Outcome, Mechanism, Cost, and validity; it has no aggregate score,
effect claim, or automatic lifecycle action.

The only operator gate is intentional: `auth login` must be invoked explicitly
before Gate 0 and the first real seven-call acceptance (one cached qualification
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
