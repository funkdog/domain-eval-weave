---
topics: [domain-modeling, ontology-engineering, knowledge-graphs, provenance, ddd, evaluation]
doc_kind: research-evidence
created: 2026-08-28
status: supporting-research
---

# Web evidence: domain truth graph methodologies

This is a primary-source-oriented evidence inventory, not the final architecture decision.

## Strategic domain boundaries

### Domain-Driven Design reference

- Source: [Eric Evans, Domain-Driven Design Reference](https://www.domainlanguage.com/ddd/reference/)
- A bounded context is the boundary within which one particular model is defined and applicable.
- A Context Map identifies the distinct models in play and their points of contact, including explicit
  translation.
- The relationship patterns include Partnership, Shared Kernel, Customer/Supplier, Conformist,
  Anticorruption Layer, Open Host Service, Published Language and Separate Ways.
- Applicability: strong guidance for where a model's language is coherent and how independently owned
  models meet.
- Limitation: DDD is aimed at complex software development and often treats team/subsystem boundaries
  as the practical context. It does not provide statement-level provenance, contested truth,
  jurisdictional applicability or a formal domain ontology.

## Ontology engineering lifecycle and networks

### Ontology Development 101

- Source: [Noy and McGuinness, Ontology Development 101](https://protege.stanford.edu/publications/ontology_development/ontology101.pdf)
- Defines an ontology as an explicit specification of domain terms and their relations.
- Promotes an iterative process: determine scope, consider reuse, enumerate terms, define classes and
  hierarchy, define properties, constraints and instances.
- Applicability: useful baseline vocabulary and competency-question discipline.
- Limitation: focused mainly on building one ontology, with limited treatment of community governance,
  competing perspectives and downstream compiled evaluation views.

### NeOn Methodology

- Sources:
  - [NeOn methodology paper](https://research.uni-sofia.bg/bitstream/10506/672/1/S3T2009_24_AGomez-Perez_MCSuarez-Figueroa.pdf)
  - [UPM deposited framework paper](https://oa.upm.es/72421/)
- Treats ontology engineering as construction of ontology networks rather than only isolated
  ontologies.
- Its scenarios cover creation from specification, reuse and reengineering of ontological and
  non-ontological resources, ontology design patterns, merging, localization and evolution.
- Applicability: close to a federated ecosystem where independent domain modules are imported, aligned
  and revised.
- Limitation: the full methodology and associated Semantic Web toolchain are much broader than the
  intended Git/YAML baseline.

### Agile and collaborative methods

- Sources:
  - [SAMOD](https://essepuntato.it/samod/)
  - [UPON Lite paper](https://doi.org/10.1145/2818359)
  - [HCOME methodology](https://doi.org/10.1007/s10115-005-0227-4)
- SAMOD iteratively develops small modellets from motivating scenarios and competency questions, then
  merges and tests them.
- UPON Lite emphasizes a domain-expert-friendly progression from terminology and glossary through
  taxonomy, relations, parthood and formalization.
- HCOME treats ontology development as a collaborative lifecycle for living ontologies in communities
  of knowledge workers.
- Applicability: strong process candidates for open-source authoring and review.
- Limitation: scenario/competency-question-driven scope can recreate benchmark-first bias if evaluation
  questions become the only completeness boundary.

## Concept schemes and relation semantics

### SKOS

- Sources:
  - [SKOS Reference](https://www.w3.org/TR/skos-reference/)
  - [SKOS Primer](https://www.w3.org/TR/skos-primer/)
- Provides concept schemes, labels, documentation notes, broader/narrower hierarchy and associative
  `related` relations.
- A concept may have multiple broader concepts.
- Provides mapping relations between independently maintained concept schemes.
- Distinguishes direct broader/narrower edges from transitive closure; warns against treating every
  associative relation as transitive.
- Applicability: proportionate semantics for labels, aliases, concept schemes, multi-parent
  classification and cross-scheme mappings.
- Limitation: not a full model for identity, state, event, process, invariant, provenance or normative
  authority.

### OntoUML and UFO

- Sources:
  - [OntoUML Community Portal](https://ontouml.org/ontouml/)
  - [OntoUML model catalog](https://github.com/OntoUML/ontouml-models)
- OntoUML uses the Unified Foundational Ontology to improve conceptual models with well-founded
  distinctions around identity, roles, qualities, relations and events.
- Applicability: valuable as a semantic audit method for difficult modeling decisions, especially
  identity, roles, part-whole, dependence and event structure.
- Limitation: theoretical and tooling complexity creates a high contributor learning cost. Adopting
  OntoUML or an upper ontology as the public authoring language would likely be disproportionate.

## Formal graph semantics and validation

### RDF and OWL 2

- Sources:
  - [RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/)
  - [OWL 2 Overview](https://www.w3.org/TR/owl2-overview/)
- RDF provides globally identified nodes and edges, datasets and named graphs. OWL 2 provides formal
  ontology semantics for classes, properties, individuals and inference.
- Applicability: useful reference semantics for stable identifiers, graph composition, imports and
  explicit relation meaning.
- Limitation: RDF serialization and an OWL reasoner are not required to gain these design benefits.
  OWL's open-world inference is not a substitute for fail-closed completeness checking.

### SHACL

- Source: [W3C SHACL Recommendation](https://www.w3.org/TR/shacl/)
- Separates an immutable data graph from a shapes graph and produces a structured validation report.
- Supports reusable shape modules and closed structural constraints.
- Applicability: strong conceptual precedent for keeping domain assertions separate from closure
  requirements and for producing explicit gap diagnostics without mutating inputs.
- Limitation: requiring RDF and SHACL syntax would add a second public authoring stack beside current
  YAML/JSON/Zod/JSON Schema.

### OWL-Time

- Source: [W3C/OGC Time Ontology in OWL](https://www.w3.org/TR/owl-time/)
- Defines instants, intervals, ordering relations, duration and temporal reference systems.
- Applicability: vocabulary guidance for temporal applicability and validity intervals.
- Limitation: full temporal ontology adoption is unnecessary for the baseline; a small profile can
  cover start/end/point-in-time/reference-system needs.

## Provenance, claims and plurality

### W3C PROV

- Sources:
  - [PROV Overview](https://www.w3.org/TR/prov-overview/)
  - [PROV Data Model](https://www.w3.org/TR/prov-dm/)
- Provides the Entity/Activity/Agent core and relations for generation, usage, derivation,
  responsibility, attribution, revision, quotation and primary sources.
- Explicitly separates provenance of a thing from the thing and includes provenance bundles and
  provenance of provenance.
- Applicability: directly relevant to Domain Releases, source snapshots, owner actions, Projection and
  Closure derivation, revision history and replay.
- Limitation: PROV records how something came to be; it does not determine whether a Claim is true or
  an agent has domain authority.

### Nanopublications

- Source: [Nanopublication Guidelines](https://nanopub.net/guidelines/working_draft/)
- A nanopublication separates assertion, provenance of the assertion and publication information into
  distinct graphs.
- Supports claims, hypotheses, opinions and negative results as small citable entities.
- Applicability: strong precedent for a Claim Envelope with separate statement evidence and release
  metadata.
- Limitation: nanopublication infrastructure, RDF signing and global publication networks are beyond
  the baseline product need.

### Wikibase/Wikidata statement model

- Sources:
  - [Wikibase Data Model](https://www.mediawiki.org/wiki/Wikibase/DataModel)
  - [Wikidata Statements](https://www.wikidata.org/wiki/Help:Statements/en)
  - [Wikidata Data Model](https://www.wikidata.org/wiki/Help:Data_model)
- Separates entities from statements. Statements carry a main claim plus qualifiers, references and a
  rank.
- Restrictive qualifiers can limit jurisdiction, place, time and universality.
- Supports multiple sourced values and explicitly treats the knowledge base as recording what sources
  state rather than directly asserting an unqualified fact about the world.
- Supports unknown and no-value markers and community-visible plurality.
- Applicability: high-value production precedent for statement-level applicability, references,
  unknown values and coexistence of conflicting claims.
- Limitation: Wikidata ranks reflect community consensus/current preference, not domain authority.
  Copying rank semantics would conflict with the project's authority model.

## Open ontology ecosystem governance

### OBO Foundry

- Sources:
  - [OBO Foundry Principles](https://obofoundry.org/principles/fp-000-summary.html)
  - [Coordinated evolution paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC2814061/)
- Principles cover openness, common format, stable identifier spaces, versioning, clearly specified
  scope, textual definitions, relation reuse, documentation, multiple users, collaboration, locus of
  authority, change notification, maintenance, responsiveness and stability of term meaning.
- Requires new identifiers when a definition would substantially change a term's referents.
- Demonstrates separately maintained ontologies with common relations, bounded subject matter and
  coordinated evolution.
- Applicability: the strongest mature precedent found for open-source governance of reusable,
  independently evolving domain assets.
- Limitation: OBO's realism and orthogonality goals are rooted in biomedical science. Product policy,
  legal norms and competing organizational models require more explicit pluralism than one reference
  ontology per subject area.

## Empirical cautions

- [Ontology engineering practice survey](https://eprints.soton.ac.uk/351596/) found ontology
  engineering to be an established discipline but emphasized customizing methods to vertical domains
  and considering economic costs.
- [Agile methodology comparison](https://doi.org/10.1016/j.compind.2022.103690) found UPON Lite,
  SAMOD and RapidOWL non-interchangeable; each supports different process/outcome needs.
- [Conceptual-modeling meta-analysis](https://doi.org/10.4018/JDM.2020100103) frames a real tradeoff:
  ontological expressiveness can improve representation while adding cognitive complexity.
- [Ontology evolution survey](https://oro.open.ac.uk/39267/) treats evolution as a multi-stage
  process with continuing open challenges.
- Biomedical ontology mapping evolution research shows that downstream mappings and annotations become
  stale as source ontologies change, supporting explicit dependency and impact tracking rather than
  silent remapping.
