---
topics: [domain-modeling, ontology-engineering, knowledge-graphs, provenance, ddd, evaluation]
doc_kind: research-synthesis
created: 2026-08-28
status: supporting-research
---

# Methodology synthesis: a mature-method profile for DomainEval Weave

Decision successor: [Domain-First Architecture v0.1](../../ARCHITECTURE.md).

## 1. Result

No mature method should be adopted wholesale. The strongest fit is a layered profile assembled from
methods that solve different problems:

```text
DDD strategic design              model boundary and points of contact
NeOn + OBO Foundry                modular network, reuse, release and governance
SKOS + selected OntoUML ideas     concepts and typed semantic relations
Wikibase + nanopublication ideas  qualified Claims, plurality and references
W3C PROV                          derivation, responsibility and revision history
SHACL principles                  immutable closed validation and gap reports
DomainEval Weave                  projection and calibrated evaluation closure
```

The recommended baseline is not RDF/OWL infrastructure. It is a Git-native YAML/JSON profile whose
semantics are intentionally aligned with these mature models and can later be exported to standards
without making them mandatory authoring dependencies.

## 2. Method disposition

| Method | Disposition | Use in DomainEval Weave |
| --- | --- | --- |
| DDD Bounded Context | Adopt as boundary heuristic | State where one model and language apply; do not equate automatically with an ontology module or industry taxonomy. |
| DDD Context Map | Adapt | Describe owned model boundaries, translations and integration relations. Extend beyond software-team relationships. |
| NeOn Methodology | Adopt as lifecycle guidance | Reuse, import, align, localize and evolve networks of independently maintained domain modules. |
| OBO Foundry principles | Adapt strongly | Scope, identifiers, releases, term stability, relation reuse, authority locus, change notification and maintenance. |
| Ontology Development 101 | Adopt for onboarding | Terms, scope, reuse, hierarchy, properties and iterative refinement. |
| UPON Lite | Pilot | Domain-expert-friendly authoring journey from terminology to relations and formalization. |
| SAMOD | Pilot with guardrail | Iterative modellets and tests are useful, but motivating scenarios must not become the only domain boundary. |
| HCOME | Conceptual guidance | Collaborative living-ontology governance and community negotiation. |
| SKOS | Adapt directly for concept schemes | Labels, aliases, definitions, broader/narrower/related, multi-parent hierarchy and cross-scheme mappings. |
| OntoUML/UFO | Use as advanced review lens | Audit identity, role, dependence, parthood, state and event modeling; do not require it from ordinary contributors. |
| RDF datasets/named graphs | Conceptual guidance/export target | Stable graph identity, separate bundles and graph composition. Do not require a triple store. |
| OWL 2 | Defer | Optional export/inference layer later; not baseline validation or authoring. |
| SHACL | Adapt semantics, not syntax | Separate immutable graph from closure shapes; generate structured validation/gap reports. |
| PROV-DM | Adopt a small conceptual profile | Entity, Activity, Agent, derivation, revision, attribution and primary source. |
| Nanopublications | Adapt Claim Envelope | Separate assertion, assertion provenance and publication/release metadata. |
| Wikibase statements | Adapt heavily | Qualifiers, references, unknown/no-value and plurality; reject consensus rank as authority. |
| OWL-Time | Adapt a small vocabulary | Valid time, intervals and reference systems for applicability. |

## 3. Top-level conceptual model

The research changes one earlier assumption: `Domain Unit` should not yet be declared synonymous with
DDD `Bounded Context`.

- A **Bounded Context** is a boundary within which one model and language apply, often with explicit
  team/system ownership.
- An **Ontology Module** is a reusable semantic artifact with declared scope and imports.
- A **Concept Scheme** organizes and maps concepts without necessarily formalizing all state and event
  semantics.

DomainEval Weave needs all three ideas but should expose one product concept only after the refund
reference model proves which distinctions users must see.

Provisional layers:

```text
Domain Module
  semantic graph + declared scope + maintainers + imports

Claim Envelope
  assertion + qualifiers/applicability + sources + authority + epistemic state

Domain Release
  immutable module snapshot + provenance + predecessor/revision metadata

Domain Landscape
  versioned composition of releases and typed mappings, without merging identities

Domain View
  contextual selection and interpretation for jurisdiction/time/actor/channel

Product Contract
  product-specific normative commitments over a Domain View

Eval Projection
  explicit selection of the truth needed for one evaluation question

Evaluation Closure
  immutable fail-closed validation shape and observation/failure semantics
```

## 4. Relationship profile

Avoid a generic `parent` edge. The baseline relation vocabulary should remain small and should reuse
well-understood distinctions:

### Concept-level relations

- `broader_than` / `narrower_than`: SKOS-like classification, allowing multiple broader concepts;
- `related_to`: non-hierarchical association with no implied transitivity;
- `part_of`: mereological composition, kept distinct from generic classification;
- `specializes`: stronger semantic specialization when substitutability or inherited constraints are
  intended.

### Module/context relations

- `imports`: one release reuses identified semantic assets from another;
- `maps_to`: explicit cross-scheme alignment without identity collapse;
- `depends_on`: a model or contract requires semantics owned elsewhere;
- `translates_via`: a DDD Context-Map-like translation boundary;
- `overlaps_with`: documented scope overlap requiring governance rather than automatic merge.

### Derivation relations

- `was_derived_from`, `was_revision_of`, `was_generated_by`, `was_attributed_to`: PROV-aligned release
  and compiler lineage.

These relation assertions are themselves governed artifacts. They require owner, source/reason,
applicability and revision metadata when their meaning is contested or contextual.

## 5. Claim model

Wikibase and nanopublications provide the best practical precedents for the project's epistemic layer.
The minimal Claim Envelope should conceptually contain:

```text
subject + predicate + object/statement
qualifiers
  jurisdiction / valid time / actor / channel / product version / conditions
references
authority assertion
epistemic status
  proposed / confirmed / unknown / conflicted / contested / unobservable
publication metadata
  author / release / revision / generated-by activity
```

Do not copy Wikidata `preferred` rank into authority semantics. A preferred community value may be
current consensus, while DomainEval Weave must preserve why a particular authority applies to a
particular Product Contract.

## 6. Refund counterexample

### DDD-only representation

```text
Commerce Orders Context
  customer of → Payments Refund Context
  translated via → refund request / refund outcome language

Payments Refund Context
  depends on → Ledger Accounting Context
  bridges to → Disputes Context
```

Strength: clarifies language ownership and translation. Weakness: does not natively show which source,
jurisdiction or expert supports a refund rule.

### SKOS-only representation

```text
refund narrower-than payment operation
refund related-to order cancellation
refund related-to chargeback
```

Strength: lightweight multi-parent concepts and mappings. Weakness: `related-to` is too weak for state,
causality, entitlement, exactly-once effects and ledger invariants.

### Claim/provenance representation

```text
Claim: an eligible cancellation creates one cash-refund entitlement
qualifiers: jurisdiction, tender type, fulfillment state, policy version
references: regulation + product policy
authority: regulator for legal duty; product owner for optional promise
status: confirmed for one view, contested or unknown elsewhere
```

Strength: preserves plural truth and applicability. Weakness: without a semantic graph it becomes a bag
of statements and cannot explain identity, state or relation structure.

### Recommended composition

- DDD-like boundaries identify the independently coherent models.
- A SKOS/OntoUML-informed semantic graph distinguishes Refund Entitlement, Refund Execution, Ledger
  Entry and Chargeback.
- Claim Envelopes state rules over those objects with sources and qualifiers.
- PROV binds revisions and compiler lineage.
- A SHACL-like closure shape requires only the subgraph needed by the order-cancellation evaluation.

## 7. What not to adopt

- No mandatory RDF, OWL, SPARQL endpoint or graph database in the baseline.
- No universal top-level ontology requirement.
- No automatic ontology merge or identity inference.
- No single global parent tree.
- No community-consensus rank standing in for domain authority.
- No benchmark cases as the only competency questions for a Domain Module.
- No silent open-world inference in a fail-closed Evaluation Closure.
- No ontology term count or graph density as domain completeness.

## 8. Recommended next discussion

Before writing a Domain-First successor Schema, freeze a Product Constitution around four decisions:

1. Is the public authoring unit a model context, an ontology module, or a combination with separate
   fields for semantic scope and governance boundary?
2. Which relation types belong in the baseline, and which are extension vocabulary?
3. Which Claim qualifiers are required for applicability, and how do authority and contested status
   compose?
4. How does a Domain Landscape reference competing modules and mappings without declaring one universal
   ontology?

Then build a refund reference model using two independently maintained modules and at least two Product
Views. Only after the model survives that exercise should the contracts and CLI be frozen.

## 9. Confidence

- High: no single methodology should be adopted wholesale.
- High: PROV concepts, OBO governance principles and Wikibase-style qualified statements are directly
  relevant.
- High: DDD Context Maps are useful for model boundaries but insufficient for truth representation.
- High: SHACL's immutable graph/shape/report separation matches fail-closed closure compilation.
- Medium: SKOS relation semantics should appear directly in the public profile; refund modeling may
  show that stronger specialization/parthood distinctions are required.
- Medium: SAMOD or UPON Lite should shape the contribution workflow; a contributor experiment is needed.
- Low/undecided: whether any RDF/OWL serialization should be offered in the first Domain Release format.
