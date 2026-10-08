---
feature_ids: []
topics: [domain-first, product, domain-truth, evaluation, open-source]
doc_kind: product
created: 2026-08-31
version: 0.1.0
status: current-direction
description: "The current DomainEval Weave product direction: model domain truth first, then compile evaluation."
---

# DomainEval Weave Product

## Product promise

> **Model the domain faithfully first; compile evaluation only when needed.**

DomainEval Weave helps a community describe domain knowledge, preserve sources and disagreement, evolve
that knowledge with provenance, and compile a bounded evaluation only when a concrete question needs to be
validated.

The product is not a benchmark factory and does not treat what is easy to grade as the boundary of a
domain.

## The problem

Teams building Agent evaluations repeatedly compress several different questions into one artifact:

- What concepts, states, events and responsibilities exist in the domain?
- Which sources support a statement, and where does that source have authority?
- Which rule applies for this jurisdiction, product, actor and time?
- What remains unknown, contested or impossible to observe?
- Which small part of that knowledge is needed by this evaluation?
- What evidence is sufficient for a fair verdict?

When these questions are answered only inside benchmark cases or grader code, the benchmark quietly
becomes the domain model. Missing telemetry becomes Candidate failure, product policy becomes universal
truth, and distinctions that do not affect today's score disappear.

DomainEval Weave makes those boundaries explicit and reviewable.

## Dependency direction

```text
Reality and evidence
  → Domain Representation
  → Domain Release
  → Domain Landscape
  → Domain View
  → Product Contract (when needed)
  → Eval Projection
  → Evaluation Closure
  → Grader / Capsule / Benchmark / Run
```

Every downstream layer may select or complete only its own responsibility. It cannot rewrite upstream
meaning or promote a Claim.

## What the product preserves

Within a declared domain boundary, the product gives explicit representation to:

- concepts, identity, relations, states, events and invariants;
- normal behavior, failure, compensation and cross-system effects;
- facts, regulations, industry practice, product policy and expert judgment as different Claim kinds;
- jurisdiction, valid time, actor, channel and product applicability;
- cross-domain dependency, overlap, translation and ownership;
- proposed, unknown, conflicted, contested and unobservable knowledge;
- revision, supersede, split, merge and retirement.

Evaluability is a downstream property. A well-described, grounded domain contribution remains valuable
even when it has no grader or current observation surface.

## Product objects

| Object | Product meaning |
| --- | --- |
| Domain Module | A scoped, semantically coherent and independently maintained model unit |
| Domain Release | An immutable, content-addressed release of one Module |
| Mapping / Bridge | A typed, scoped relation between independently owned representations |
| Domain Landscape | A versioned composition of exact Releases and Mappings |
| Claim | A qualified proposition with sources, applicability, authority annotation and epistemic state |
| Domain View | The domain knowledge applicable to one context |
| Product Contract | Product-specific commitments over an exact View |
| Eval Projection | The explicit domain subgraph selected for one evaluation question |
| Evaluation Closure | The identity, observation and failure semantics required for a reliable verdict |

The domain is a graph, not a directory tree. A concept or Module may participate in several Landscapes,
and competing representations may coexist without automatic merging.

## Primary user journey

```text
Describe a Model Context
  → add Concepts, Claims and Sources
  → preserve unknown and disagreement
  → publish a Domain Release
  → compose a Domain Landscape
  → select a contextual View
  → publish product commitments when relevant
  → project one evaluation question
  → compile or reject the Evaluation Closure
  → calibrate and run an exact grader
  → replay the result from immutable artifacts
```

A domain expert can stop after contributing Concepts, Claims, sources, counterexamples or mappings. They
do not need to write grader code for the contribution to be useful.

## Coverage and readiness

The product does not publish a global domain-completeness score. Coverage is derived relative to a
versioned scope and remains multidimensional:

```text
described / grounded / authoritative / observable / evaluated / qualified
```

`missing`, `unknown`, `contested`, `unobservable` and `out_of_scope` are different results. They must not
collapse into one red or green indicator.

Domain maturity and Eval maturity are independent. A domain may be authoritative but unobservable, or a
benchmark may be runnable while its domain representation remains weak.

## Hard-verdict boundary

The minimum hard grade is one independently falsifiable Claim applied to one eligible Episode with a
complete evidence chain. An Episode includes opportunity, behavior and consequence.

When identity, applicability, Claim selection, observation completeness or missing-evidence semantics do
not close, the product refuses a hard verdict. It distinguishes:

```text
pass / fail / not_applicable / insufficient_evidence / indeterminate
```

An absent record is not proof of absent behavior unless the Observation Contract proves that the relevant
window and channel are complete.

## Governance

Contribution, publication, support and selection are different decisions. Module maintainers own semantic
coherence; Mapping reviewers own cross-context assertions; Landscape curators select exact compositions;
product authorities own product commitments; Eval owners define measurement without becoming truth
authorities.

Published history can grow, but the default working surface remains bounded through supported Releases,
published Landscapes and explicit archive policy. The current product never treats every known version as
one active global graph.

## Current internal proof point

The repository now contains a substantial synthetic Commerce Landscape rather than another
benchmark-shaped Capsule. Its internal compiler covers order cancellation, cash refund, coupon
restoration, provider execution, ledger reconciliation and adjacent dispute semantics; preserves
competing representations and multiple Product Contracts; and produces both a valid hard Closure and an
honest Closure refusal. Its Grade Atoms have visible validation evidence, an independent qualification
protocol and a pending runtime-verified external-Curator freeze/execution/unseal chain.

The acceptance conditions for that reference model are defined in [ARCHITECTURE.md](ARCHITECTURE.md).

## Current implementation

The public package surface remains a Capsule-first Developer Preview. The repository additionally
implements the Commerce Domain-First reference through M4 as an internal, unexported compiler. Public
Schema, TypeScript API and CLI promotion remain an M5 decision.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the exact current boundary.
