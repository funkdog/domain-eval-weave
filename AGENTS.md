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


<!-- CAT-CAFE-GOVERNANCE-START -->
> Pack version: 1.4.1 | Provider: codex

## Clowder AI Governance Rules (Auto-managed)

### Hard Constraints (immutable)
- **Clowder AI runtime ports**: frontend 3003 and API 3004 are reserved by Clowder AI. Avoid using these ports for this project's dev servers.
- **Redis port 6399** is Clowder AI's production Redis. Never connect to it from external projects. Use 6398 for dev/test.
- **No self-review**: The same individual cannot review their own code. Cross-family review preferred.
- **Identity is constant**: Never impersonate another cat. Identity is a hard constraint.

### Collaboration Standards
- A2A handoff uses five-tuple: What / Why / Tradeoff / Open Questions / Next Action
- Vision Guardian: Read original requirements before starting. AC completion ≠ feature complete.
- Review flow: quality-gate → [fresh-context-review] → request-review → receive-review → merge-gate
- Skills are available via symlinked cat-cafe-skills/ — load the relevant skill before each workflow step
- Shared rules: See cat-cafe-skills/refs/shared-rules.md for full collaboration contract

### Quality Discipline (overrides "try simplest approach first")
- **Bug: find root cause before fixing**. No guess-and-patch. Steps: reproduce → logs → call chain → confirm root cause → fix
- **Uncertain direction: stop → search → ask → confirm → then act**. Never "just try it first"
- **"Done" requires evidence** (tests pass / screenshot / logs). Bug fix = red test first, then green

### Knowledge Engineering
- Documents use YAML frontmatter (feature_ids, topics, doc_kind, created)
- Three-layer info architecture: CLAUDE.md (≤100 lines) → Skills (on-demand) → refs/
- Backlog: BACKLOG.md (hot) → Feature files (warm) → raw docs (cold)
- Feature lifecycle: kickoff → discussion → implementation → review → completion
- SOP: See docs/SOP.md for the 6-step workflow
<!-- CAT-CAFE-GOVERNANCE-END -->
