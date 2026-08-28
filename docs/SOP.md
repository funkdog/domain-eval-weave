---
topics: [sop, workflow]
doc_kind: note
created: 2026-08-17
---

# Standard Operating Procedure

## Repository Contract

Read `README.md`, `CONTRIBUTING.md`, and the phase-specific product and implementation
contracts before changing code. Their data-safety and persistence boundaries apply
to every workflow below.

This repository currently has no Git remote. Use exact local commits as review
and merge carriers; do not wait for or claim PR, cloud-review, push, or remote-main
evidence until a remote is configured.

## Risk-routed Workflow

| Step | Action |
|------|--------|
| 1 | Ground the task in the public contribution contract, the applicable phase contract, and current Git state. |
| 2 | Use a feature worktree for code, execution-surface, high-risk, or conflicting work. Conflict-free, reversible documentation may land directly on local `main`. |
| 3 | Run proportional quality gates and bind their evidence to the exact candidate commit. |
| 4 | Obtain independent exact-commit review for code and governance changes; reuse an existing verdict only when continuity is mechanically provable. |
| 5 | Merge only the approved candidate into local `main`, preserving unrelated work and resolving any overlap explicitly. |
| 6 | Verify the merged tree, report the exact revision and unavailable remote evidence, and leave tracked state clean. |

If a remote is later configured, PR, cloud review, push, and remote-main checks
are selected independently by conflict, behavioral, safety, and delivery risk;
they are not unconditional steps.

## Code Quality

- Frozen dependencies when installation is required: `pnpm install --frozen-lockfile`
- Biome: `pnpm check` (use `pnpm check:fix` only for an intentional formatting edit)
- TypeScript: `pnpm lint`
- Tests: `pnpm test`, or a narrower package script only when the risk is truly isolated
- Build: `pnpm build`
- Package boundary changes: `pnpm pack --dry-run`

There is no repository line-count gate. Refactor when design or maintainability
requires it, not to satisfy an imported generic threshold.
