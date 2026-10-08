---
feature_ids: []
topics: [domain-first, domain-modeling, domain-landscape, provenance, evaluation-closure, governance]
doc_kind: architecture
created: 2026-08-31
version: 0.1.0
status: proposed-baseline
description: "DomainEval Weave v0.1 architecture baseline: model domain truth first, then compile bounded evaluation closures."
decision_provenance: thread_msx25fw48rony7bs
---

# DomainEval Weave Domain-First Architecture v0.1

## 1. Status and purpose

This document records the agreed product philosophy and architectural semantics for a future
Domain-First successor to the current DomainEval Weave Developer Preview.

It is a **design baseline**, not an implementation specification. It does not change the current public
package surface described in [IMPLEMENTATION.md](IMPLEMENTATION.md), or authorize a Schema, CLI, storage,
Registry or migration implementation.

The purpose of v0.1 is to establish a stable coordinate system for one substantial reference Domain
Landscape before implementation choices are frozen.

## 2. Product thesis

> DomainEval Weave lets a domain be described faithfully, extended collaboratively, kept plural and
> evolved with provenance. When a concrete question needs validation, the system compiles the relevant
> domain truth into a bounded, calibratable and rejectable Evaluation Closure.

The first user-perceived value is:

> **Model the domain faithfully first; compile evaluation only when needed.**

The dependency direction is one-way:

```text
Reality and evidence
  → Domain Representation
  → Domain Release
  → Domain Landscape
  → Domain View
  → Product Contract (when evaluating a product commitment)
  → Eval Projection
  → Evaluation Closure
  → Grader / Capsule / Benchmark / Run
```

A Benchmark is one execution expression of a Closure. It must not define the domain boundary, promote a
Claim, create a product commitment or erase knowledge that is difficult to observe.

## 3. Domain completeness

Completeness is always relative to a declared scope. It does not mean encyclopedic exhaustion.

Within that scope, every distinction with material semantic, causal, behavioral, normative, temporal,
responsibility, risk or cross-domain meaning needs an explicit place. Known, unknown, conflicted,
contested and unobservable knowledge must not be silently discarded.

The completeness dimensions are:

- **semantic** — concepts, identity, relations, states, events and definitional invariants;
- **behavioral** — normal flow, failure, compensation and cross-system interaction;
- **normative** — facts, regulation, industry practice, product policy and expert judgment remain distinct;
- **conditional** — jurisdiction, valid time, actor, channel, population and product version;
- **boundary** — dependencies, bridges, overlap and responsibility between model contexts;
- **epistemic** — proposed, unknown, conflicted, contested and unobservable are first-class;
- **evolutionary** — revision, supersede, split, merge and retirement preserve history.

Evaluability is a downstream property, not an admission criterion for domain knowledge.

## 4. Core architectural objects

| Object | Responsibility | Must not do |
| --- | --- | --- |
| Model Context | Define the boundary in which one language and model remain coherent | Act as an industry taxonomy or repository path |
| Domain Module | Own and release one primary Model Context with its semantic and epistemic assets | Contain product-specific verdicts, Gold cases or graders |
| Domain Release | Freeze one immutable, content-addressed Module snapshot | Mutate after publication or depend on floating versions |
| Mapping / Bridge | Relate independently owned concepts or contexts with typed, scoped, directional assertions | Infer identity from equal names or silently merge models |
| Domain Landscape | Compose exact Domain Releases and Mappings for an industry or business environment | Copy all modules into a universal model or select every version combination |
| Domain View | Select applicable domain knowledge for time, jurisdiction, actor, channel and other context | Add product promises, alter authority or silently resolve conflicts |
| Product Contract | Publish product-specific normative commitments over an exact Domain View | Rewrite domain concepts or promote product policy into universal truth |
| Eval Projection | Select the Claims and semantic subgraph needed by one evaluation question | Drop semantically necessary knowledge because it is hard to observe |
| Evaluation Closure | Bind identity, applicability, observation, time, absence and failure semantics | Invent domain truth or guess through unresolved gaps |
| Capsule / Grader / Benchmark | Package and execute an exact Closure | Become an upstream truth source |

Initial constraint: one Domain Module has one primary Model Context. More complex packaging requires
evidence from the reference Landscape before it enters the public model.

## 5. Semantic Model and Claim Envelope

### 5.1 Semantic Model

The Semantic Model defines stable, referenceable domain language inside one Model Context:

- concepts and their identity criteria;
- typed relations;
- roles and dependencies;
- states and state transitions;
- events and causal structure;
- definitional invariants.

An invariant belongs here only when violating it changes what the concept is. Rules that vary by
jurisdiction, product, provider or time belong in Claims or Product Contracts.

### 5.2 Claim Envelope

A Claim references semantic objects and states a qualified proposition. Its dimensions remain separate:

```text
Claim kind
  descriptive_fact / normative_rule / industry_practice
  / product_policy / expert_judgment / hypothesis

Epistemic state
  proposed / grounded / confirmed / conflicted / contested / unknown / retired

Observability
  observable / partially_observable / unobservable / unknown
```

A confirmed Claim may be unobservable. A contested Claim may be fully observable. A technically
observable proposition may remain ungrounded.

Each Claim needs explicit applicability, sources, provenance, valid time and recorded time.

### 5.3 Authority

Two authority concepts must not be conflated:

- **Source Authority** describes why a source is relevant for a class of Claims and the scope in which
  that authority applies.
- **Governance Authority** describes who may accept, publish or select a Module, Mapping, Release,
  Landscape or Product Contract.

Source Authority is scoped evidence metadata, not a global rank and not an automatic truth decision.
A regulator may be authoritative about a legal obligation; a provider about its execution contract; a
product owner about that product's commitment; an implementation maintainer about the behavior of an
exact software artifact or release. Those authorities do not substitute for one another. In particular,
implementation-maintainer authority cannot establish provider capability, industry consensus, legal
duty or financial finality.

The first version records this annotation and its evidence without pretending to provide a complete
authority-certification system.

## 6. Graph, plurality and identity

The domain is a typed graph, not a single parent tree. A concept or module may participate in multiple
larger landscapes. Classification, composition, dependency, overlap and translation are different
relations.

The baseline relation vocabulary remains intentionally small and typed. Candidate families include:

```text
Concept relations
  broader_than / narrower_than / related_to / part_of / specializes / distinct_from

Context and mapping relations
  imports / maps_to / depends_on / translates_via / overlaps_with / realizes

Evolution and provenance relations
  was_derived_from / was_revision_of / superseded_by / split_into / merged_from
```

The final public vocabulary and its inference rules are deferred until tested against the reference
Landscape.

Multiple representations of the same subject may coexist under different Module identities. A community
refund model, a provider refund model and a regulator remedies model are not successive versions of one
Module. A Landscape selects exact releases and explicit mappings for its purpose; a Registry discovers
assets but does not decide universal truth.

Concept identity changes when referent, causal mechanism, lifecycle, rights, obligations, accounting
effect or responsibility meaning changes. Differences that can be fully expressed as qualified statements
remain separate Claims over the same Concept. Different Model Contexts may model the same real-world
episode through distinct local Concepts joined by explicit mappings.

## 7. Versioning, ledger and bounded active surface

Published Domain Releases are immutable and content-addressed. Human-readable versions support
communication; digests establish artifact identity.

The system distinguishes:

```text
Concept identity and revision
Claim identity and revision
Mapping identity and revision
Domain Release
Landscape Release
View / Contract / Projection / Closure version
```

Substantive identity change creates a new Concept ID or an explicit split, merge or supersede relation.
Old identities are retired, not deleted. Claims and Mappings do not migrate across such changes without
an explicit reviewed decision.

The ledger records both:

- **valid time** — when a fact, rule or commitment applies in the represented world;
- **recorded time** — when the system learned and recorded it.

This supports Domain replay, knowledge replay and Evaluation replay without interpreting the past using
today's knowledge.

Immutability must not create a multi-version domain lake. Three planes remain separate:

| Plane | Default participation |
| --- | --- |
| Historical Ledger | Exact lookup, impact analysis and replay only |
| Supported Domain Surface | Available for new composition |
| Compiled Landscape / View | Exact, purpose-specific active subgraph |

Release support lifecycle and knowledge maturity are different:

```text
Release lifecycle
  candidate / published / supported / superseded / archived / withdrawn

Knowledge maturity dimensions
  described / grounded / authoritative / observable / evaluated / qualified
```

New work uses supported releases selected by a published Landscape. Historical Closures continue to pin
archived releases. The system does not maintain the Cartesian product of all Module versions, and it never
treats the global union of all history as the current model.

## 8. Governance and contribution

Contribution and promotion are separate:

```text
Proposal Workspace
  → Candidate Module
  → Published Release
  → Supported Domain Surface
  → selected Landscape
```

Not every edit becomes a permanent release. Publication means the artifact is stable and traceable; it
does not mean every Claim is confirmed, observable or evaluated.

Minimum responsibilities are:

| Responsibility | Decision boundary |
| --- | --- |
| Contributor | Propose Concepts, Claims, sources, counterexamples and Mappings |
| Module Maintainer | Maintain semantic coherence, IDs, scope and Module Releases |
| Mapping Reviewer | Review the meaning and scope of cross-context relations |
| Landscape Curator | Select exact Releases and Mappings without rewriting them |
| Product Authority | Publish commitments for an exact product and applicability scope |
| Eval Owner | Define Projection, Closure, grader and calibration without promoting truth |

One person may hold several responsibilities, but each action records which responsibility was exercised.

A Published Release requires stable identity, declared scope and ownership, reference integrity,
provenance, predecessor or fork reason, change classification and an impact report. It does **not** require
a grader, observability, absence of dispute or adoption by a product.

## 9. Coverage and maturity

Coverage is a derived diagnostic relative to a versioned Scope Declaration. It is not an author-entered
percentage and must not be reduced to node count, graph density or benchmark count.

The derived layers are:

```text
Semantic Coverage
Evidence Coverage
Authority Coverage
Applicability Coverage
Observability Coverage
Evaluation Coverage
```

`missing`, `unknown`, `contested`, `unobservable` and `out_of_scope` have different meanings and must be
displayed separately. A semantically mature but unobservable area is valid domain knowledge; it is simply
not ready for a hard evaluation.

Scope changes are versioned and reviewed so that contributors cannot improve apparent coverage by
silently removing difficult concepts.

## 10. Evaluation compilation

Each compiler layer may narrow or complete its own responsibility; it may not rewrite upstream meaning.

### Domain View

Selects applicable Concepts, Claims and Mappings from an exact Landscape using jurisdiction, valid time,
actor, channel and other contextual dimensions. It preserves unresolved conflict and unobservability.

### Product Contract

Pins an exact View and publishes product-policy Claims for a concrete product, version and market. A legal
baseline, a provider capability and a stricter product promise may coexist without impersonating one
another.

### Eval Projection

States the evaluation question and explicitly selects and excludes Claims and semantic objects. Semantic
relevance determines selection; measurement convenience does not.

### Evaluation Closure

Completes the selected question with exact:

- entity and episode identity;
- Claim revisions and applicability;
- observation bindings and completeness assumptions;
- business time, observation time and allowed lateness;
- missing-evidence and absence semantics;
- atomic failure and composition rules;
- release, mapping, compiler and grader versions.

An incomplete Closure rejects a hard grader with structured blockers. It may instead support evidence-only
reporting or require an explicitly narrower evaluation question.

Minimum result semantics are:

```text
pass / fail / not_applicable / insufficient_evidence / indeterminate
```

No record proves failure only when the Observation Contract establishes complete coverage, a closed
window, identity closure, retention coverage and absence of alternative unobserved channels.

## 11. Hard grade granularity

The minimum hard grade is:

> **one independently falsifiable Claim applied to one eligible Episode, supported by a complete and
> deterministic evidence chain.**

An Episode contains opportunity, behavior and consequence. A Schema check is a guard; a matched event is
an observation predicate; neither alone is a domain grade.

Grade Atoms are split when Claim, applicability, evidence source, authority, failure semantics,
remediation ownership or consumer action differs. Composite verdicts preserve the atomic vector rather
than hiding asymmetric obligations in a weighted score.

Hardness comes from Claim clarity, applicability, identity, observation completeness, deterministic
predicate, explicit missing-data semantics, calibration and repeatability — not merely from using
deterministic code.

Each Grade Atom needs a utility claim, estimator, validity bounds, consumer, calibration plan and
repeatability contract. Discovery, tuning, calibration and qualification must not reuse one undifferentiated
fixture cohort.

## 12. Reference Commerce Landscape

Implementation must begin from a sufficiently complete reference Landscape rather than a single
benchmark-shaped Capsule.

### 12.1 Core Modules

The first reference composition should include at least:

```text
commerce.orders
payments.refunds
promotions.coupons
finance.ledger
```

and explicit bridges to adjacent representations such as:

```text
payments.disputes
provider-specific refund execution
jurisdictional consumer-remedies Claims
```

The exact Module boundaries remain subject to validation by the reference modeling exercise.

### 12.2 Reference episode

Use a synthetic paid, unshipped order with total value 100:

```text
cash tender: 80
coupon entitlement: 20
```

An accepted cancellation exercises order state, cash refund, coupon restoration, provider execution,
exactly-once economic effect and ledger reconciliation.

The model must keep `CashRefund`, `CouponRestoration`, `GoodwillCredit`, `Chargeback`, `Return`, provider
settlement and ledger reconciliation distinct even when one evaluation does not select them all.

### 12.3 Required design tests

The reference Landscape is sufficient only if it demonstrates:

1. independently released Modules joined by typed mappings;
2. at least one competing provider representation without identity collapse;
3. at least two Product Contracts over one Domain View with different commitments;
4. confirmed, contested, unknown and unobservable Claims;
5. Source Authority with different scopes for regulator, provider and product owner;
6. one explicit revision, split or supersede with downstream impact reporting;
7. more than one Eval Projection from the same Domain Release set;
8. one successful hard Closure and one honest Closure refusal caused by an observation or epistemic gap;
9. Grade Atoms for cash amount/tender, timeliness, coupon restoration, economic exactly-once and ledger
   reconciliation;
10. artifact-only replay bound to exact releases and digests;
11. a versioned Scope Declaration and derived Coverage report that distinguish `missing`, `unknown`,
    `contested`, `unobservable` and `out_of_scope`; excluding an in-scope but difficult-to-observe Concept
    from one Eval Projection must not reclassify it or improve the reported Domain Coverage;
12. bitemporal replay for a Claim whose real-world `valid_time` precedes its `recorded_time`, proving that
    the system can reconstruct both the rule applicable to the historical episode and the knowledge state
    available before the late source or revision was recorded.

This reference work validates the architecture. It must not be reduced to producing a green benchmark.

## 13. Explicit non-goals and deferred decisions

v0.1 does not decide:

- final JSON/YAML Schemas or field enums;
- repository and package layout;
- graph database, remote Registry or hosted service;
- mandatory RDF, OWL, SHACL or SPARQL authoring;
- a universal upper ontology or global canonical domain model;
- automatic model merging, identity inference or authority ranking;
- strict Source Authority certification;
- Coverage UI or a cross-dimensional total score;
- release-number compatibility policy;
- final grader formulas, thresholds and calibration cohorts;
- migration of the current Capsule-first Developer Preview.

The baseline remains Git-native, offline-first, transparent and export-friendly. Mature methods inform the
semantics without becoming mandatory infrastructure.

## 14. Decision and research provenance

Product decisions were co-created in `thread_msx25fw48rony7bs`, including the operator's correction that
domain truth must precede evaluation and the subsequent agreement on modules, Claims, Views, authority,
ledger evolution, bounded governance, Coverage, Closure and hard-grade granularity.

Methodology evidence and disposition are recorded in:

- [Mature-method profile for DomainEval Weave](research/domain-truth-methodologies/synthesis.md)
- [Primary-source evidence inventory](research/domain-truth-methodologies/evidence.md)
- [Research brief](research/domain-truth-methodologies/brief.md)

The evidence supports a lightweight profile drawn from DDD strategic design, ontology-network and OBO
governance, SKOS/OntoUML relation discipline, qualified statement models, PROV lineage and SHACL-like
closed validation. No method is adopted wholesale.

## 15. Version policy for this document

- `0.1.x` may clarify wording and examples without changing the architectural boundaries above.
- A change to dependency direction, object responsibility, truth/evaluation separation, governance
  authority or hard-verdict admission requires an explicit design decision and a new minor version.
- Implementation contracts may specialize this baseline but must identify any divergence explicitly.
- This document advances from `proposed-baseline` only after content review of the rendered source and the
  reference Landscape plan.
