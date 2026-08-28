+---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, open-source, licensing, decision]
doc_kind: research
created: 2026-08-27
description: "Codebase-grounded license recommendation and operator decision packet."
---

# DSH Eval Lab license boundary synthesis

This is an engineering recommendation based on primary license texts and the Phase 4B package/Capsule
architecture. It is not legal advice and does not apply a license without operator approval.

## Recommendation

### Repository and package code

Adopt **Apache-2.0** for:

- `@dsh-eval/lab` code, generated schemas and repository-authored documentation;
- `@dsh-eval/dsh-adapter` code;
- public portions of the root legacy compatibility code;
- repository-authored Evaluators, cases and Candidate fixtures unless a file says otherwise.

Why: the project explicitly invites engine, sandbox, adapter and evaluator contributions. Apache-2.0 is OSI
approved and provides an explicit contribution/patent grant and termination framework. MIT is simpler but
does not express that patent relationship.

### Synthetic reference sources

Keep repository-authored synthetic files under
`examples/capsules/*/sources/**` as **CC0-1.0**, with an explicit directory marker and the existing
per-source manifest declarations.

Why: these files are intended to be copied, remixed and used as calibration/source fixtures without
attribution bookkeeping. CC0 applies only because the project authors the synthetic material and can make
the dedication.

### Community Capsule sources

Do **not** impose one global data license. Every source retains its declared SPDX/license expression and
provenance. Public contribution policy must require the contributor to have redistribution authority. A
source marked proprietary/internal can be valid in a private Capsule but is not publishable in the public
repository.

CC-BY-4.0 remains an allowed per-source choice where attribution is desired.

## Disconfirming considerations

- Apache-2.0 is longer and more compliance-heavy than MIT.
- Creating a NOTICE file creates preservation duties; do not add one unless actual attribution notices
  require it.
- Apache-2.0 is not GPL-2.0-only compatible according to ASF guidance, though it is compatible with GPLv3.
- CC0 cannot clear privacy, publicity, trademark, patent or third-party rights.
- License grants are not a reversible experiment for already distributed copies. Operator approval is
  required before Developer Preview.

## Exact implementation after approval

1. Add the unmodified Apache-2.0 text to root `LICENSE`, `packages/weave/LICENSE` and
   `packages/dsh-adapter/LICENSE`.
2. Set public package `license` fields to `Apache-2.0`; keep `legacy/dsh-eval-lab` private.
3. Change Lab/adapter `private` only at the release step, not in the licensing commit.
4. Add `packages/weave/examples/commerce-cancellation/sources/LICENSE` identifying those synthetic source files
   as CC0-1.0 with the canonical URL.
5. Update CONTRIBUTING to state inbound=outbound Apache-2.0 for code and to require per-source Capsule
   license/provenance authority.
6. Update `.github/open-source-status.json` from `unselected` to an explicit structured policy.
7. Extend readiness checks so a selected policy requires physical LICENSE files and matching package
   metadata.
8. Rebuild both tarballs and verify each includes the intended LICENSE.

## Options

| Option | Code | Synthetic sources | Position |
| --- | --- | --- | --- |
| A | Apache-2.0 | CC0-1.0 | Recommended |
| B | MIT | CC0-1.0 | Acceptable, weaker explicit patent posture |
| C | Apache-2.0 | CC-BY-4.0 | Valid, higher fixture attribution burden |
| D | One license for everything | Same as code | Opposed; obscures per-source rights |

## Operator Decision Packet

**Decision requested:** approve Option A, choose another option, or defer for legal review.

**Value gained:** unlocks Developer Preview with an OSI-approved code license while keeping synthetic
Capsule fixtures frictionless and preserving third-party source license boundaries.

**Tradeoff:** Apache-2.0 has more notice/patent terms than MIT; CC0 intentionally gives up attribution control
for the marked synthetic sources.

**Irreversibility:** copies already distributed under Apache-2.0 or CC0 cannot have those permissions
retroactively withdrawn.

**Recommended answer:** `Approve A: Apache-2.0 code/docs + CC0-1.0 repository-authored synthetic sources;
community sources retain declared licenses.`

## Operator decision

Approved directly by the operator on 2026-08-27. Implementation scope is the local Phase 4B branch only:
Apache-2.0 LICENSE files and package metadata, CC0-1.0 markers for repository-authored synthetic sources,
and the corresponding readiness transition. The approval does not authorize remote creation, push, package
publication or repository visibility changes.
