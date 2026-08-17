# DSH Eval Lab

DSH Eval Lab is a local, personal experiment bench for measuring how one
harness intervention changes open-coding delivery under controlled conditions.

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

## Current state

The workspace and planning truth sources are initialized. Product implementation
has not started. The next unit is Milestone 0: repository contracts, red parser
tests, canonical JSON/digests, artifact references, and the CLI skeleton.
