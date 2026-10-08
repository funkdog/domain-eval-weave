---
feature_ids: []
topics: [domain-eval-weave, open-source, licensing, provenance]
doc_kind: research-decision
created: 2026-08-27
status: current-provenance
description: "The approved DomainEval Weave license boundary and its decision provenance."
---

# DomainEval Weave license boundary

This document records the provenance of the repository's current license policy. It is not legal advice.

## Current policy

### Code and repository-authored documentation

DomainEval Weave code, generated Schemas and repository-authored documentation use **Apache-2.0**.

This includes:

- `@domaineval/weave`;
- `@domaineval/dsh-adapter`;
- the private legacy compatibility package where repository-authored code is distributed;
- repository-authored Evaluators, cases and Candidate fixtures unless a file declares otherwise.

Apache-2.0 was selected because the project invites engine, sandbox, adapter and evaluator contributions
and benefits from an explicit patent grant and termination framework.

### Repository-authored synthetic sources

Synthetic reference source files explicitly marked by the repository use **CC0-1.0**. The designation is
limited to material authored by the project and does not clear privacy, publicity, trademark, patent or
third-party rights.

### Community Capsule sources

Community sources retain their declared license or SPDX expression. Contributors must have authority to
redistribute a source before adding it to the public repository. Proprietary or internal sources may be
valid in a private Capsule but are not publishable here.

## Boundaries

- Do not create a `NOTICE` file unless actual attribution notices require one.
- Apache-2.0 and CC0 apply only to their explicitly declared material.
- A source license is independent from Claim truth, authority and applicability.
- License grants already made to distributed copies cannot be retroactively withdrawn.
- Package publication remains a separate release decision.

## Decision provenance

The operator approved Apache-2.0 for code/docs plus CC0-1.0 for repository-authored synthetic sources on
2026-08-27. Community sources retain their declared licenses.

The approved policy is implemented by the root and package `LICENSE` files, package metadata,
`CONTRIBUTING.md`, per-source markers and `.github/open-source-status.json`. Automated governance checks
require this document to remain present as the human-readable provenance of that decision.
