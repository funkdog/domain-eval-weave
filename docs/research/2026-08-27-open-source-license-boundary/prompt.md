+---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, open-source, licensing, capsule-data]
doc_kind: research-prompt
created: 2026-08-27
description: "Primary-source research prompt for DSH Eval Lab code, documentation and Capsule asset licensing."
---

# DSH Eval Lab open-source license boundary research prompt

## Problem Frame

Select a legally clear, contributor-friendly license boundary for an open-source monorepo whose default product is a TypeScript Capsule/Evaluator engine, with optional DSH adapter, private legacy compatibility code, documentation and synthetic reference Capsule assets. This research informs an operator decision; it does not itself apply a license.

Non-goals: legal advice, relicensing third-party material, selecting licenses for contributor-owned external sources, or publishing the repository.

## Current Hypotheses

1. Apache-2.0 is preferable to MIT for engine code because an explicit patent grant matters for an evaluator/tooling ecosystem.
2. Repository-authored documentation can use the code license initially to avoid mixed-license friction.
3. Synthetic reference source data can remain CC0 when clearly marked, while every contributed Capsule source retains its own declared license.
4. A global data license must not override per-source Capsule provenance.

Evidence gaps: exact Apache patent/notice duties, OSI status, CC0 scope and caveats, CC BY attribution burden, and how to state mixed file-level exceptions.

## Disconfirm First

Look for reasons Apache-2.0 would be worse than MIT for this project, whether CC0 is unsuitable for synthetic reference assets, whether one repository-wide license is safer, and whether a separate documentation/data license creates contributor confusion.

## Source Mix Quota

Use primary sources first:

- Apache Software Foundation license and FAQ;
- Open Source Initiative approved-license pages and definition;
- Creative Commons legal code/official FAQ for CC0 and CC BY 4.0;
- SPDX official identifiers or specification where useful.

Secondary guidance may clarify packaging but cannot override license texts.

## Local Constraints

- `@dsh-eval/lab` contains engine code, generated schemas, CLI and a synthetic Commerce reference.
- Each Capsule source already carries a `license` field.
- The current Commerce synthetic sources declare CC0-1.0.
- No production user data or third-party proprietary source may be relicensed.
- Root legacy code must remain compatible but need not be public in the first release.
- Developer Preview is blocked until the operator selects code/data license policy.

## Output Schema

For each option provide:

- supported / opposed / unresolved;
- primary-source evidence;
- obligations and risks;
- fit to code, docs, generated schemas, synthetic assets and community Capsules;
- confidence.

Then provide one recommended policy and exact file/manifest changes, clearly marked as a recommendation requiring operator approval.

## Decision Interface

Map conclusions to:

- adopt for Developer Preview;
- pilot with explicit exceptions;
- defer pending legal review.

## Risk Register

If wrong, risks include incompatible third-party contributions, accidental relicensing of Capsule sources, missing attribution/NOTICE obligations, patent ambiguity, inability to publish packages, or expensive later relicensing.
