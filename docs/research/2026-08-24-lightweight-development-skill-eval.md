---
feature_ids: [F192, F267]
topics: [dsh, eval-lab, agent-skills, tdd, research]
doc_kind: research
created: 2026-08-24
description: "Primary-source research and decision for a pinned external TDD Skill in the next bounded DSH Eval Lab pilot."
---

# Lightweight development Skill for the next DSH Eval Lab pilot

## Research question

Which maintained, widely adopted, lightweight coding-agent Skill can be used as the treatment in a DSH Eval Lab requirements-delivery experiment without making Eval Lab the owner of the development workflow?

Selection criteria:

- exists and works outside Eval Lab;
- inspectable, licensed and content-addressable;
- no required reviewer service, merge gate or special runtime;
- one declared control/treatment difference;
- natural task opportunity and typed mechanism evidence;
- direct relationship to delivery quality;
- bounded cost and a falsifiable utility claim.

Popularity is a discovery signal, not evidence of effect.

## Primary-source findings

### Agent Skills is a portable production format

GitHub documents Agent Skills as an open standard supported across Copilot cloud agent, code review, CLI and IDE surfaces. Anthropic documents the same filesystem-based `SKILL.md` format and progressive disclosure model.

- https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

GitSkills reports 3,797,117 `SKILL.md` files across 282,200 public repositories in a July 2026 crawl. This establishes ecosystem scale, not quality or causal utility.

- https://arxiv.org/abs/2608.10906

### Most generic Skill injections do not improve delivery

SWE-Skills-Bench pairs 49 public SWE Skills with pinned repositories and requirement-driven tasks. Its preliminary results report:

- 39 of 49 Skills produced no pass-rate improvement;
- average gain was +1.2%;
- token overhead reached +451% in some cases without pass-rate gain;
- seven specialized Skills produced meaningful gains;
- three Skills degraded performance when guidance conflicted with the project version.

- https://arxiv.org/abs/2603.15401

The implication for Eval Lab is to select for task fit and context compatibility, then measure marginal utility locally.

## Candidate comparison

| Candidate | Strength | Blocking issue | Decision |
|---|---|---|---|
| Matt Pocock `tdd` | Compact, public-interface tests, independent expected values, vertical red-green slices | Requires a Task Pack that permits Agent-authored tests and freezes test seams | Bounded pilot after Task redesign |
| Superpowers `verification-before-completion` | One `SKILL.md` and broad completion trigger | Current DSH agents already run public verification, leaving weak treatment contrast | Follow-up negative control |
| Superpowers `systematic-debugging` | Clear bug trigger and observable investigation sequence | Larger folder and references adjacent TDD/verification Skills | Later bug-repair Suite |
| Superpowers `requesting-code-review` | Real development review workflow | Requires reviewer subagent and blocking review behavior | Defer |
| Matt Pocock `code-review` | Separates Standards and Spec | Two parallel subagents plus issue/spec setup | Defer |
| GitHub Awesome Copilot `review-and-refactor` | Available in an official community collection | Conflates review with mutation; individual effect not established | Reject for first pilot |

Sources:

- https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md
- https://github.com/obra/superpowers/tree/main/skills/systematic-debugging
- https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/SKILL.md
- https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md
- https://github.com/github/awesome-copilot/blob/main/docs/README.skills.md

GitHub made Agent Skills available to Copilot code review in July 2026, confirming that Skill-guided review is a real product pattern. The public review candidates inspected here remain heavier than the requested first intervention.

- https://github.blog/changelog/2026-07-29-copilot-code-review-agent-skills-and-mcp-now-generally-available/

## Decision

Use the exact Matt Pocock `tdd` Skill for one bounded pilot.

This is a pilot-selection decision, not a claim that TDD Skills generally improve coding agents.

### Frozen upstream closure

Read-only GitHub API verification on 2026-08-24:

```text
repository: mattpocock/skills
commit: 5b15a47f2d7150f545fbcacbfe381787fc0230dc
path: skills/engineering/tdd/

SKILL.md           blob 8fc086710806190ee7c4baa32089cb877a75736a  size 3549
tests.md           blob 7ab86479f925a1f9e8ba680af33cb3b12e015381  size 2214
mocking.md         blob 71cbfee674d93244ce81d1830b930ca9a69200bd  size 1481
agents/openai.yaml blob 651b838a7663e027b1b8884491e867f26bb9a021  size 87
LICENSE            blob f1dd2c09108dde1a5f56097cee8461b3ea834499  size 1068
license: MIT
```

The pilot binds these bytes and a locally computed closure digest; it never follows upstream `main`.

## Experiment

### Control

- external TDD Skill disabled;
- same public test-first requirement;
- model uses its native TDD knowledge.

### Treatment

- exact external TDD Skill enabled;
- no bootstrap Skill, hook, reviewer, subagent workflow or additional tool.

### Task successor

The current Commerce Task only authorizes `src/` changes and cannot expose a real red-green loop. The successor Task Pack must:

- authorize a bounded tests path;
- publish `preconfirmed_test_seams`;
- give both arms identical test-first wording without a Skill name or arm label;
- retain public starter tests without revealing hidden Oracle cases;
- keep `codebase-design` unavailable in both arms;
- treat any request for that dependency as Harness mechanism invalid, not Candidate failure;
- preserve the hidden Delivery/Semantic/Code Quality adjudication boundary.

### Mechanism evidence

Typed DSH events reconstruct:

- Skill exposed and loaded;
- first test write before first production-code write;
- focused test fails for the target behavior;
- minimal implementation follows;
- focused test and full suite pass;
- refactor, if any, occurs after green;
- Agent tests touch only authorized public seams.

Agent-authored tests enter Code Quality evidence and never become the external Delivery Oracle.

### Task buckets

1. `TDD-suitable`: stateful behavior or bug fix with fixed public seams.
2. `borderline`: small behavior change where Skill utility may be negligible.
3. `non-trigger`: documentation, configuration or static-content task.
4. `holdout`: unseen requirement with the same testing affordance.

## Falsifier

Reject this Skill as the next baseline when the pilot shows any of:

- treatment does not load the Skill on TDD-suitable tasks;
- control already exhibits the same red-green mechanism;
- treatment adds material cost without Delivery, Semantic or Code Quality improvement;
- tests become implementation-coupled or tautological;
- treatment over-applies TDD to non-trigger tasks;
- the observed behavior is only a ceremony induced by task wording.

## Confidence

Medium-high for pilot selection; low for an expected positive effect. Portability, maintenance and inspectability are well supported. The local paired pilot remains the authority on utility.
