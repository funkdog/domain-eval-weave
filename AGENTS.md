# DomainEval Weave Agent Guide

## Start here

Read `README.md`, then the current product and implementation contracts:

- `docs/plans/2026-08-26-dsh-eval-lab-phase-4b-product-plan.md`
- `docs/plans/2026-08-26-dsh-eval-lab-phase-4b-implementation-spec.md`

The public implementation and Schemas live in `packages/weave/`; the optional DSH integration lives in
`packages/dsh-adapter/`. Root `src/` and the historical evaluation assets remain private compatibility
surfaces; do not extend them when a change belongs in the runner-neutral Capsule/Evaluator boundary.

## Safety and truth

- Use only synthetic, licensed, or explicitly authorized fixture data.
- Keep generated `.eval/`, runtime, credential, and Session data outside the source tree.
- Never read, print, copy, move, hash, or commit credentials and OAuth material.
- Candidate execution must remain fail-closed, offline, sandboxed, and unable to read Capsule truth.
- LLM output and schema validity never confirm a Claim; only declared domain authority can do that.
- Persisted releases, calibrations, and Runs remain content-addressed and replayable.

## Development

- Reproduce bugs before fixing them and work red-to-green.
- Run `pnpm build:packages`, `pnpm check:public`, `pnpm lint:public`, and `pnpm test:public`
  for public changes.
- Run the historical `pnpm test` suite only when changing legacy compatibility surfaces on a
  supported maintainer environment.
- Keep changes within the frozen phase contract. Do not add a Web UI, remote registry, automatic
  truth confirmation, arbitrary remote execution, or a production LLM Judge.
- Do not claim completion without tests bound to the exact revision and a clean worktree.
- Authors cannot approve their own implementation.
