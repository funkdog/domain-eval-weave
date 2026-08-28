+---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, open-source, licensing, evidence]
doc_kind: research
created: 2026-08-27
description: "Primary-source evidence for the DSH Eval Lab license boundary."
---

# Open-source license boundary: primary-source evidence

This is informational engineering research, not legal advice.

## Apache-2.0

- The Open Source Initiative lists Apache-2.0 as an approved, popular/strong-community license:
  https://opensource.org/license/apache-2.0
- The Apache Software Foundation states that Apache-2.0 was designed for reuse by non-ASF projects and
  recommends including the full license in a top-level LICENSE file:
  https://www.apache.org/foundation/license-faq.html
- Apache-2.0 Section 3 grants recipients a patent license for patent claims necessarily infringed by a
  contribution, and terminates the grant for a party initiating specified patent litigation:
  https://www.apache.org/licenses/LICENSE-2.0.html
- ASF guidance says a NOTICE file should be considered and is required to be preserved when applicable;
  third-party works retain their original license identification and required notices:
  https://www.apache.org/legal/apply-license

Engineering implication: Apache-2.0 provides an explicit code-contribution and patent framework that is
useful for an extensible evaluator/runner ecosystem, but creates more compliance text than MIT and requires
careful treatment of any NOTICE/third-party material.

## MIT

- SPDX publishes the canonical MIT identifier and text:
  https://spdx.org/licenses/MIT.html
- OSI lists MIT as an approved license:
  https://opensource.org/licenses

The MIT text grants broad rights and requires preservation of copyright/license notices. It contains no
explicit patent-grant or patent-termination section comparable to Apache-2.0.

Engineering implication: MIT is shorter and widely familiar, but the absence of explicit patent language is
a material tradeoff for a project inviting engine, sandbox, adapter and evaluator contributions.

## Open-source definition

OSI states that open source requires more than visible source: free redistribution, source availability,
derived works, non-discrimination, license portability, no restriction on other software and technology
neutrality:
https://opensource.org/osd

Engineering implication: source-available or non-commercial Capsule terms must not be described as an
open-source software license. Per-source proprietary material can exist in private Capsules but cannot be
silently included in a public open-source distribution.

## CC0-1.0

- CC0 is a public-domain dedication and fallback license designed to relinquish copyright and related rights
  to the greatest extent permitted:
  https://creativecommons.org/publicdomain/zero/1.0/legalcode.en
- Creative Commons says CC0 enables use for any purpose without an attribution requirement:
  https://wiki.creativecommons.org/wiki/CC0_FAQ
- CC0 does not waive trademark or patent rights and cannot clear third-party copyright, privacy, publicity or
  other rights:
  https://creativecommons.org/publicdomain/zero/1.0/legalcode.en
- Creative Commons supports CC0 for databases to maximize reuse:
  https://creativecommons.org/faq/

Engineering implication: CC0 fits repository-authored synthetic source fixtures where the project controls
all relevant rights. It must never be inferred for interview transcripts, company policies, production data
or third-party source material.

## CC BY 4.0

- CC BY 4.0 permits commercial sharing and adaptation but requires appropriate credit, a license link and an
  indication of changes:
  https://creativecommons.org/licenses/by/4.0/
- Creative Commons says CC licenses are appropriate for content and data but does not recommend them for
  software/hardware:
  https://creativecommons.org/share-your-work/licensing-considerations/version4/

Engineering implication: CC BY is suitable when attribution is an intentional property of a contributed
source, but applying it to the default synthetic fixture corpus would add copying/derivative bookkeeping
that CC0 avoids.

## SPDX identifiers

The SPDX License List recognizes Apache-2.0, MIT, CC0-1.0 and CC-BY-4.0 identifiers:
https://spdx.org/licenses/

These exact identifiers should appear in package metadata and Capsule source declarations.
