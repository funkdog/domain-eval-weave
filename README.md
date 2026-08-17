# DSH Eval Lab

DSH Eval Lab is a DSH-native local plugin for measuring how one harness
intervention changes open-coding delivery under controlled conditions.

Phase 1 fixes the domain, task pack, model route, and intervention. It compares
the DSH Goal stack off versus on and produces diagnostic evidence only; one
paired run cannot support a general uplift claim.

## Canonical plans

- [Product plan](docs/plans/2026-08-17-dsh-eval-lab-product-plan.md)
- [Phase 1 implementation spec](docs/plans/2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)

## Workspace boundary

- Source repository: `/Users/slipshod/AIBuild/dsh-eval-lab`
- Persistent runtime data: `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`
- OAuth reference lab: `/Users/slipshod/AIBuild/dsh-codex-oauth-lab` (read-only reference)

The runtime root is intentionally outside Git and has mode `0700`. Never put
OAuth credentials, DSH sessions, candidate workspaces, Oracle artifacts, or
campaign outputs in this repository.

## Product entry

Phase 1 is installed as a DSH bundle and has no standalone `dsh-eval` command.
Every supported DSH process receives the dedicated home before boot:

```sh
umask 077
install -d -m 700 /Users/slipshod/AIBuild/dsh-eval-lab-runtime
install -d -m 700 /Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh plugin --profile eval add <local-checkout-or-built-tarball>
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval --help
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval init
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval auth status
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval auth login
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval doctor
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval calibrate
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval run
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval report <campaign-id>
```

## Current state

Phase 1 Milestones 0–4 are implemented. The bundle owns the management app and
runner-only safety bridge; `init` freezes the opposite profile roles; the built-in
Task Pack calibrates a seeded eight-behavior Oracle against red, gold, and three
targeted mutants; the carrier freezes Candidate Git artifacts before Oracle;
the Session projector separates Outcome, Mechanism, Cost, and measurement
validity; and the serial pair coordinator emits replayable JSON and Markdown
without an aggregate score or effect claim.

The only operator gate is intentional: `auth login` must be invoked explicitly
before Gate 0 and the first real three-Episode acceptance. Eval Lab never opens,
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
