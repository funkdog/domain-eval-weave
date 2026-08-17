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

Milestone 0 is implemented as a local candidate. It contains:

- strict Zod parsers and four JSON Schema interoperability faces;
- deterministic canonical JSON and SHA-256 content digests;
- portable `artifact://campaign/...` references with traversal, symlink, and
  digest checks;
- source/runtime/reference-root separation checks;
- a side-effect-free CLI skeleton with the frozen exit-code families;
- fake Campaign artifact replay tests that use only the dedicated runtime root.

No DSH package, model carrier, OAuth command, Oracle, or Campaign runner is
installed or executed by Milestone 0.

## Development

Use the frozen Node 24 toolchain, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm typecheck
pnpm build
node bin/dsh-eval.mjs --help
```
