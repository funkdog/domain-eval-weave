# DSH Eval Lab Agent Guide

## Truth sources

- Product boundary: `docs/plans/2026-08-17-dsh-eval-lab-product-plan.md`
- Implementation contract: `docs/plans/2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md`
- Phase 2 implementation contract: `docs/plans/2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md`

Read the product boundary and the implementation contract for the phase in scope before coding.
Do not broaden either phase beyond its frozen contract.

## Safety boundaries

1. Use only synthetic fixture data. Never connect to production user data.
2. Keep all runtime state under `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`.
3. Never read, print, copy, move, or hash OAuth credentials.
4. Never read `~/.codex/auth.json`, `~/.dsh`, Clowder Redis/SQLite, Clowder API,
   or Clowder localhost ports.
5. Treat `/Users/slipshod/AIBuild/dsh-codex-oauth-lab` as a read-only acceptance
   reference; do not build this product inside it.
6. Persist Campaign and Session artifacts by default. Do not add automatic TTL
   or cleanup behavior.

## Development discipline

- Work red-to-green in the milestone order frozen by the implementation spec.
- Diagnose root causes before fixes and keep evidence bound to exact revisions.
- Do not claim completion without proportional tests and a clean candidate.
- Do not add Web UI, an open-ended domain registry, an LLM Judge, multi-user roles,
  remote evaluators, or automatic promotion/rollback during Phase 1 or Phase 2.
- Keep the source repository free of runtime artifacts and secrets even when a
  matching ignore rule exists; physical separation is the actual boundary.
