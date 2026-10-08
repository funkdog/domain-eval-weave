---
topics: [domain-modeling, ontology-engineering, knowledge-graphs, provenance, ddd, evaluation]
doc_kind: research-prompt
created: 2026-08-28
status: supporting-research
---

# Research Brief: Mature Methodologies for Domain Truth Graphs and Evaluation Projections

## 1. Problem Frame

We are designing the next product architecture for DomainEval Weave, an open-source, offline-first
TypeScript system that currently turns sources and expert judgment into provenance-bound Claims,
calibrated Evaluators and replayable Runs.

The current public model is Capsule-first: Sources → Claims → Requirements → calibration cases →
Evaluator → Run. We have concluded that this ordering can make a benchmark define the domain boundary.
The intended ordering is instead:

```text
Reality and evidence
  → Domain Representation
  → versioned Domain Release
  → contextual Domain View
  → Product Contract
  → Eval Projection
  → immutable Evaluation Closure
  → Capsule / Grader / Benchmark / Run
```

We need to identify mature methodologies and standards that can inform this architecture without
inventing a proprietary ontology system.

Core questions:

1. How should independently evolving domain units, larger domain landscapes and contextual views be
   distinguished?
2. How should a graph express hierarchy, composition, dependency, overlap and cross-domain bridges
   without collapsing everything into one parent tree?
3. How should semantic objects (concepts, identities, states, events, workflows, invariants) be
   separated from epistemic statements (Claims, provenance, authority, uncertainty and conflict)?
4. How should descriptive facts, normative rules, product policies, regulations and expert judgments
   coexist without impersonating one another?
5. How should applicability by jurisdiction, time, actor, channel and product version be represented?
6. How should revision, supersession, retirement, split, merge, ontology alignment and competing
   representations preserve historical identity?
7. How can a task-specific evaluation projection select a subgraph while making information loss,
   exclusion and unobservability explicit?
8. Which mature methods are suitable for a Git-native open-source project, and which would push us
   into an unnecessarily general ontology platform?

Non-goals:

- Designing the final DomainEval Weave Schema or CLI in this research step.
- Selecting a graph database or building a Web UI.
- Automatic ontology extraction, LLM truth confirmation or unrestricted logical inference.
- Creating a globally canonical ontology of all domains.
- Treating benchmark coverage as domain completeness.

Why now: the current Developer Preview has a robust Capsule/Evaluator execution boundary, but its
public README and contribution journey are evaluation-first. Before implementing a domain-first
successor, the conceptual model must be grounded in established practice.

## 2. Current Hypotheses

Our current hypotheses are:

1. No single methodology covers the full problem; a disciplined combination is likely required.
2. DDD strategic design and Context Maps may best define ownership boundaries and integration
   relationships, but do not by themselves encode evidence, uncertainty or formal constraints.
3. Ontology-network methodologies such as NeOn, METHONTOLOGY or Ontology Development 101 may inform
   lifecycle, reuse, alignment and evolution.
4. RDF/OWL/SKOS may provide useful semantics, but adopting their complete machinery may be excessive
   for a YAML/JSON, Git-native product.
5. PROV-O and claim-centered approaches such as nanopublications may inform statement-level
   provenance and authority.
6. SHACL-like closed validation is likely more relevant to evaluation closure than unrestricted OWL
   reasoning because the product must fail closed and report exact gaps.
7. Domain identity should be stable and independent from display namespaces. Typed graph edges,
   rather than path prefixes, should carry relationship meaning.
8. Domain completeness should be evaluated within a declared boundary as a multidimensional vector,
   not as a score or node count.

Evidence gaps:

- Whether mature ontology-network methods handle competing authority, contested truth and contextual
  applicability well enough for this use case.
- Whether DDD bounded contexts map cleanly to reusable community domain assets rather than one
  organization's software boundaries.
- Which provenance patterns remain practical in version-controlled human-readable files.
- How existing standards model temporal validity and normative versus descriptive assertions.
- Proven failure modes from projects that attempted universal knowledge models or mixed ontology and
  operational evaluation concerns.

These are hypotheses, not conclusions. Please try to falsify them.

## 3. Disconfirm First

Before presenting supportive evidence:

1. Find successful systems that use a simpler taxonomy or document model rather than an ontology
   graph.
2. Find evidence that DDD bounded contexts are the wrong abstraction for shared domain knowledge.
3. Find cases where RDF/OWL, SKOS, SHACL, PROV-O, nanopublications or upper ontologies created more
   complexity than value.
4. Find cases where federated or multi-perspective ontologies caused unresolved identity, alignment,
   governance or performance problems.
5. Challenge the assumption that concepts and Claims must be separate layers.
6. Identify risks in treating a Domain View as a pure selection instead of a legitimate contextual
   reinterpretation.

## 4. Source Mix Quota

Use primarily authoritative and original sources. Cover at least three source classes:

- W3C, ISO or OMG specifications and official primers;
- primary methodology papers/books from the original authors of DDD strategic design,
  METHONTOLOGY, NeOn, Ontology Development 101, OntoUML/UFO or comparable approaches;
- maintained open-source implementations or public domain-modeling case studies;
- engineering retrospectives describing ontology, knowledge-graph or domain-modeling failure modes.

Candidate families to investigate, without assuming adoption:

- Domain-Driven Design strategic design, bounded contexts and Context Maps;
- METHONTOLOGY, NeOn Methodology and Ontology Development 101;
- RDF/RDFS, OWL 2, SKOS, SHACL, PROV-O and named graph patterns;
- nanopublications or other assertion/provenance/publication decompositions;
- OntoUML/UFO or other conceptual-modeling methods with explicit relation semantics;
- ISO 704 / ISO 25964 terminology and thesaurus relationship practices;
- ontology modularization, networks, alignment, versioning and temporal knowledge graphs.

For every important claim, trace to a primary source where possible. Mark vendor or consultancy
conflicts, publication date and the precise object to which the evidence applies.

## 5. Local Constraints

Any recommendation must work under these constraints:

- Open-source users edit transparent YAML/JSON/Markdown reviewed through Git.
- The default runtime is offline-first and must not require a graph database or hosted registry.
- Sources, provenance, authority, unknown, conflict, contested truth and unobservability are first-class.
- Domain-only contributions must be valuable without a Grader or benchmark.
- Evaluation artifacts are compiled downstream and must never promote domain authority.
- Releases and Runs are content-addressed, immutable and replayable.
- Historical revisions must remain addressable after supersede, split or merge.
- The product should support multiple organizations and competing representations without claiming one
  universal ontology.
- Candidate execution and evaluation fail closed; missing evidence must not be silently inferred.
- Avoid multiplying public packages or Schemas without demonstrated need.
- Current implemented boundary: the DomainEval Weave Capsule-first Developer Preview, which exposes one main
  `@domaineval/weave` package and an optional DSH adapter.

## 6. Output Schema

Produce:

### A. Methodology comparison

For each candidate methodology or standard:

| Method | Problem it solves | Native concepts | Strengths here | Mismatches/risks | Primary sources |
| --- | --- | --- | --- | --- | --- |

### B. Evidence for and against our hypotheses

Separate supporting and opposing evidence, each with source, confidence and applicability.

### C. Recommended composition

Map each required concern to one of:

- adopt directly;
- adapt as a local profile;
- use only as conceptual guidance;
- reject/defer.

Required concerns:

- domain boundary and ownership;
- concept/relation/state/event modeling;
- provenance and authority;
- uncertainty and conflict;
- applicability and temporality;
- modularization, bridges and multi-membership;
- evolution and alignment;
- closed validation;
- projection into evaluation closure.

### D. Counterexample walkthrough

Model refunds across commerce, payments, accounting and disputes. Show how at least two methods would
represent the relationships differently and where each representation becomes misleading.

### E. Minimal DomainEval Weave profile

Recommend the smallest defensible conceptual profile, explicitly listing what not to adopt.

### F. Confidence summary and unresolved questions

Rate each recommendation high/medium/low and state what evidence would change it.

## 7. Decision Interface

For every finding, label the proposed action:

- **Adopt**: mature, directly applicable and proportionate;
- **Pilot**: promising but requires a bounded reference-model experiment;
- **Defer**: useful later but unnecessary for the baseline;
- **Reject**: conflicts with the product boundary or adds unjustified complexity.

The final recommendation must be usable to draft a Domain-First Product Constitution and successor
product contract, not an implementation patch.

## 8. Risk Register

Analyze at least these risks:

1. Ontology overengineering: the project becomes a generic semantic-web platform.
2. Benchmark leakage: evaluation needs still shape the supposedly independent domain model.
3. False universality: one organization's taxonomy is presented as objective truth.
4. Ambiguous relationship semantics: `subdomain_of`, `included_in`, `part_of` and `depends_on` are
   conflated.
5. Provenance theater: source links exist but cannot justify authority or applicability.
6. Open-world/closed-world mismatch: semantic inference conflicts with fail-closed evaluation.
7. Version identity failure: split/merge/supersede breaks downstream replay.
8. Community governance failure: competing models cannot coexist or align.

## Local anchors supplied with this brief

- The implemented Developer Preview uses Capsule as its primary runtime asset; the current README now
  distinguishes that shipped boundary from the Domain-First product direction.
- The current Developer Preview deliberately excludes a remote registry, Web UI, automatic confirmation and arbitrary
  remote execution.
- Existing `domain_id` values are flat strings; dotted names are not validated hierarchy.
- The historical Claim Dependency Graph connects Claims and Requirements across domains, but is not a
  domain taxonomy or ontology graph.
- Recent operator decision: domain truth must be modeled before evaluation; benchmark is one compiled
  expression and must not define the domain boundary.
