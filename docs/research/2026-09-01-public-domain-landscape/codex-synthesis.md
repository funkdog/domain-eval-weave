---
feature_ids: []
topics: [public-domain-landscape, product-direction, payments, ecommerce, software-supply-chain]
doc_kind: research-synthesis
created: 2026-09-01
status: preliminary-recommendation-revised
---

# Preliminary Synthesis: First Public Domain Landscape

## Recommendation

Adopt **payment lifecycle and funds closure** as the leading candidate for the first authoritative public
Domain Landscape. Retain software artifact trust/supply-chain provenance as a developer-centric control
Landscape and likely second implementation.

This revision follows an explicit operator challenge: the first recommendation over-weighted low manual
cost and machine-verifiability, and under-weighted business-domain richness, authority conflicts and the
ability to expose actual onboarding pain. This is not yet a final source/license acceptance.

## Why this candidate fits the product thesis

Payments make DomainEval Weave prove both public authority and real business-domain modeling:

- regulation, scheme/protocol rules, provider contracts, OSS implementations and merchant policies create
  visibly different, non-substitutable Authority scopes;
- Mojaloop, Hyperswitch, Kill Bill and provider APIs expose independently owned representations of intent,
  authorization, capture, refund, transfer, settlement, dispute and reconciliation;
- asynchronous state, retries, idempotency, partial value, clearing/settlement and ledger effects provide
  non-trivial lifecycle and identity semantics;
- provider event time, business effective time, clearing time, settlement time and knowledge time create
  real bitemporal replay problems;
- payment success, refund acceptance, economic effect, dispute reversal and ledger reconciliation are
  distinct Claims and observations;
- the domain is broadly understandable to contributors while still exposing difficult authority,
  applicability and observation gaps;
- official schemas/APIs and OSS tests can automate much of the evidence work without automating policy or
  legal judgment.

## Proposed Landscape boundary

> For one exact payment obligation, can the parties establish its intent, authorization, captured economic
> effect, refunds or disputes, clearing/settlement obligations and final ledger reconciliation—and can a
> concrete evaluation prove or honestly refuse each claim from available observations?

Initial Model Contexts:

```text
payments.intent
payments.authorization
payments.capture
payments.refunds
payments.disputes
payments.transfers
payments.clearing
payments.settlement
payments.reconciliation
finance.ledger
payments.orchestration.hyperswitch
payments.scheme.mojaloop
payments.provider.stripe
payments.regulation.eu
```

Explicit adjacent/non-goals for v1:

- cardholder or bank-account production data;
- fraud-model quality and AML/KYC verdicts;
- universal card-network rule interpretation;
- merchant product/catalog/order truth beyond payment obligation references;
- tax calculation;
- legal compliance verdicts;
- every payment method, provider and jurisdiction in v1.

## Candidate Views

1. Card-like authorization/capture/refund through a provider-scoped API.
2. Mojaloop-style asynchronous transfer, clearing position and deferred or gross settlement.
3. Multi-provider orchestration with retries that preserve one economic effect.
4. Refund versus dispute/chargeback as distinct causal and authority paths.
5. Reconstruct the payment state knowable before late provider or settlement evidence arrived.
6. Refuse a hard verdict when webhook completeness, provider identity, settlement evidence or ledger
   reconciliation is unavailable.

## Baseline Bench family

Potential Grade Atoms:

- payment intent/obligation identity;
- authorization and capture amount/currency consistency;
- cumulative refund not exceeding captured refundable value;
- original-tender and provider applicability;
- exactly-one successful economic effect despite technical retries;
- refund acceptance versus actual settlement;
- dispute/chargeback kept distinct from merchant refund;
- participant position and liquidity constraints;
- clearing-to-settlement obligation consistency;
- ledger reconciliation;
- missing-webhook/late-observation semantics;
- provider-neutral versus provider-specific mapping preservation.

Gold/equivalent/mutant cases can derive from official API schemas, OSS state machines and repository-authored
synthetic Episodes, then be independently sealed for qualification. Public cases remain validation only.

## Low-human-cost thesis to test

Automate:

- exact source snapshot/update detection;
- spec/schema parsing and reference extraction proposals;
- content digest and license/provenance inventory;
- Claim candidate extraction with source locators;
- cross-format identity/mapping suggestions;
- source and implementation divergence reports;
- Coverage, impact and Closure compilation;
- deterministic verification and mutant generation.

Keep human judgment for:

- Domain Scope;
- whether two local objects have the same real referent;
- Source Authority scope;
- conflicts between standards, implementations and regulation;
- risk-bearing release policy;
- publication/support lifecycle;
- independent qualification Curator role.

## Main disconfirmation risks

1. Provider docs may leak into universal Claims unless Authority is strictly scoped.
2. Card-network and ISO artifacts may have redistribution or access constraints.
3. Regulation may require legal review and jurisdiction-qualified Claims.
4. Synthetic Episodes may miss operational failure modes in real settlement/reconciliation.
5. Mojaloop, Hyperswitch, Stripe and ledger models may not share stable identities.
6. Payment breadth may become unbounded unless v1 excludes fraud, KYC/AML, tax and all-provider coverage.
7. Deterministic checks may overfit public provider fixtures and mistake API conformance for economic truth.

## Next research actions

1. Complete the primary-source/license inventory for PSD2/EU payment law, Mojaloop, Hyperswitch, Kill Bill,
   Stripe and at least one additional provider/ledger implementation.
2. Inspect versioned OpenAPI/spec schemas and fixture licenses directly.
3. Compare identity and lifecycle semantics across intent/authorization/capture/refund/dispute/settlement.
4. Freeze the minimum non-trivial Scope Declaration and explicit exclusions.
5. Build a synthetic cross-implementation Episode fixture without production data.
6. Compile one complete Closure and at least two honest refusals.
7. Measure manual effort for source authority, mapping, applicability and observation closure.
8. Keep the supply-chain Landscape as a follow-up control to test generality.

## Decision status

- Payment lifecycle/funds closure: **Adopt for full research and flagship implementation pilot.**
- Software supply-chain security: **Pilot as a low-manual-cost control and likely second Landscape.**
- Internet identity: **Defer until the payment pilot proves scope/governance mechanics.**
- E-commerce: **Compose after the payment foundation, adding orders, returns, logistics and promotions.**
