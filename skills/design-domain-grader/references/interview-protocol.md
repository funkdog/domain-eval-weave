# Interview protocol

## Contents

1. Mode preparation
2. Question order
3. Per-turn persistence
4. Delta scoping
5. Stop conditions

## 1. Mode preparation

For `onboard`, enumerate the product, domain slices, authorized sources, owner identity, and intended decision consumer. Do not assume the requirement text contains all product truth.

For `delta`, validate the exact base Contract and current graph first. Map requirement nouns, operations, identities, and state transitions to existing Claims before proposing new ones.

For `audit`, freeze the source snapshot being audited. Separate source disappearance, source contradiction, stale observation, and policy evolution.

## 2. Question order

Ask high-information concrete scenarios in this order, skipping axes that cannot change the current domain:

1. Successful case: inputs, identities, before/after authoritative state, user-visible result.
2. Rejected case: prohibited state/actor/input and required lack of side effects.
3. Replay: same identity and same payload; same identity and conflicting payload.
4. Concurrency/order: simultaneous, delayed, duplicated, or reordered operations.
5. Partial failure: external success/internal failure and the reverse.
6. Restart/recovery: durable truth, convergence responsibility, deadline.
7. Cross-domain conservation: money, inventory, entitlement, event, or count relations.
8. Risk: false acceptance, false rejection, and who consumes the future verdict.

Prefer: “A paid order used 80 cash and a 20 coupon. What is refunded, what is restored, and which store is authoritative if they disagree?”

Avoid: “Define all refund invariants.”

## 3. Per-turn persistence

After each answer:

1. Create or revise Evidence Cards without changing their stable Claim IDs.
2. Bind the answer as an `owner_statement` SourceRef.
3. Recompute the five-state projection.
4. Show the user the changed IDs and why their status changed.
5. Persist open decision questions with blocked Claim IDs.

Do not summarize away contradictory source language. A conflict requires both refs and a reason.

## 4. Delta scoping

Build an initial affected set from Requirement terms and explicit edges. Expand through Contract dependencies and reverse impact. Ask about:

- Claims in that closure;
- proposed new/modified/deprecated Claims;
- adjacent preservation Claims whose false-accept risk is high or critical.

Do not revisit unrelated active Claims unless their source, observation, or dependency changed.

## 5. Stop conditions

Stop asking and emit a decision packet when:

- the remaining question is a policy choice;
- authority sources conflict;
- the observer is unavailable or untrusted;
- legal/experience/semantic interpretation lacks a signed rubric;
- the user cannot authorize the source or decision.

Stop the mode successfully when primary artifacts are persisted, deterministic validation passes, and readiness honestly reflects remaining non-blocking gaps.
