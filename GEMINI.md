# DSH Eval Lab Provider Entry

Before any work, read and follow `AGENTS.md` in full. Its repository-specific
truth sources, safety boundaries, phase limits, and persistence requirements
override the generic managed block below. If `AGENTS.md` is unavailable, stop
rather than infer its contents.

Non-negotiable summary:

- Use synthetic fixtures only; keep runtime state under
  `/Users/slipshod/AIBuild/dsh-eval-lab-runtime` and out of this source tree.
- Never read OAuth credentials, `~/.codex/auth.json`, `~/.dsh`, Clowder
  Redis/SQLite, the Clowder API, or Clowder localhost ports.
- Treat `dsh-codex-oauth-lab` as read-only and persist Campaign/Session artifacts
  by default without automatic TTL or cleanup.
- Read the product boundary and the implementation contract for the phase in
  scope before implementation.

<!-- CAT-CAFE-GOVERNANCE-START -->
> Pack version: 1.4.1 | Provider: gemini

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
- Shared rules: See `.gemini/skills/co-creation-docs/../refs/shared-rules.md` for the full collaboration contract

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
