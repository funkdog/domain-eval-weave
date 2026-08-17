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
```

## Current state

Plugin-first Milestone 0 is implemented as a local candidate: bundle manifest,
app/bridge entrypoints, pure app grammar, runtime-root invariants, four strict
artifact contracts, canonical JSON/digests, and full fake-Campaign replay.

Milestone 0 does not install or run DSH, invoke OAuth, or create a real Campaign.
Milestone 1 adds DSH profile composition, the safety bridge, auth facade, and
doctor.

## Development

Use Node 24 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
```
