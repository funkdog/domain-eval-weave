---
feature_ids: []
topics: [payments, public-domain-landscape, integration-plan, benchmarking, contribution]
doc_kind: implementation-plan
created: 2026-09-01
version: 0.2.0
status: proposed
---

# Public Payments Domain Landscape — Complete Integration Plan v0.1

## 1. Objective

Build a substantial, publicly reproducible Payment Lifecycle and Funds Closure Landscape from primary
public evidence and real open-source implementations, then prove that an enterprise can attach its own
code, policy and observation surface without rewriting public domain truth.

The result must provide:

1. a reusable public Domain Landscape;
2. a low-manual-cost contribution paradigm;
3. baseline validation Bench families;
4. an independent qualification path;
5. an enterprise-overlay workflow;
6. a measured record of real onboarding and maintenance friction.

This plan does not authorize public Schema/API/CLI promotion. The current Domain-First compiler remains
internal until the public payment pilot passes its acceptance gates.

## 2. Definition of “complete”

Completeness is relative to one versioned Scope Declaration, not the whole global payments industry.

The v0.1 question is:

> For one exact payment obligation, can participating systems establish its intent, authorization,
> captured economic effect, refund or dispute consequences, clearing/settlement obligations and final
> ledger reconciliation—and can an evaluation prove or honestly refuse each selected Claim from the
> available observations?

Within that scope, every material distinction needs an explicit place:

- identity and referent;
- lifecycle state and transition;
- normal, failure, retry and compensation behavior;
- economic effect and value conservation;
- responsibility and authority;
- jurisdiction/provider/product applicability;
- valid time and recorded time;
- evidence and observation completeness;
- unknown, disputed, unobservable and out-of-scope knowledge;
- version evolution and downstream impact.

A large node count is not evidence of completeness.

## 3. Initial scope

### Included

- payment intent and merchant obligation reference;
- payer/payee, merchant and payment-participant identities;
- authorization, capture and cancellation;
- partial and full refunds;
- technical retry versus successful economic effect;
- disputes and chargebacks as a separate causal path;
- asynchronous transfer and participant position;
- clearing and settlement obligation;
- provider payout/settlement representation;
- merchant ledger entries and reconciliation;
- provider webhooks and observation completeness;
- EU payment-services regulatory Claims used only in their jurisdiction;
- explicit release-policy and product-commitment overlays.

### Adjacent but explicitly excluded from v0.1

- fraud-model quality;
- KYC/AML decisions;
- sanctions screening;
- tax calculation;
- foreign-exchange pricing;
- cardholder or bank-account production data;
- card-network rules that cannot be legally redistributed;
- every payment method/provider/jurisdiction;
- full commerce catalog, inventory, fulfillment and returns;
- legal-compliance verdicts;
- organization-wide payment maturity scores.

Exclusions remain referenceable adjacent Concepts. They are not deleted from the larger graph.

## 4. Two-layer truth architecture

```text
Public Evidence Plane
  laws / official standards / scheme specs / provider docs / OSS releases
        ↓
Public Payment Domain Modules and exact Releases
        ↓
Public Payment Landscape
        ↓
Enterprise implementation overlays
  code / OpenAPI / DB schema / events / config / runbooks
        ↓
Exact Enterprise View
        ↓
Product Contract
        ↓
Observation Profile
        ↓
Evaluation Closure
        ↓
Validation Bench / independently qualified Run
```

Rules:

- Public Modules never import enterprise code or product promises.
- Enterprise code proves what one implementation does, not universal payment truth.
- Provider documentation proves provider-scoped behavior only.
- Regulation proves jurisdiction-scoped duties only.
- Product owners may publish product commitments but cannot promote them into universal payment rules.
- Runtime telemetry is observation evidence, not domain authority.
- Enterprise overlays can add Claims and Mappings; they cannot mutate public Releases.
- Immutable references preserve source identity and replayability; they do not create authority.
- Public repository assets and enterprise overlay assets occupy separate physical roots.

### Physical roots

The checked-in public root is limited to redistribution-approved public evidence records, public
Modules, Mappings and Landscapes:

```text
packages/weave/examples/public-payments-landscape/
```

Every enterprise overlay is stored outside Git under the isolated runtime root:

```text
/Users/slipshod/AIBuild/dsh-eval-lab-runtime/enterprise-payments/{enterprise-id}/
```

Enterprise source indexes, code-derived Modules, Mappings, Views, Product Contracts, Observation
Profiles, Episodes, validation inputs and qualification inputs remain in that runtime root. A checked-in
synthetic public reference may demonstrate the public workflow, but it must be explicitly authored as a
public fixture and must not contain or derive from an enterprise overlay.

## 5. Proposed Model Contexts

| Module | Primary responsibility | Example authorities |
|---|---|---|
| `payments.intent` | Payment obligation, amount, currency and merchant reference | Public model maintainers |
| `payments.authorization` | Authorization request, approval, decline and expiry | Scheme/spec + OSS |
| `payments.capture` | Captured value and capture lifecycle | Provider/spec + OSS |
| `payments.refunds` | Refund instruction, refundable value and economic refund effect | Public spec/OSS |
| `payments.disputes` | Dispute, chargeback, evidence and reversal | Provider/scheme scoped |
| `payments.transfers` | Payer/payee participant transfer semantics | Mojaloop/FSPIOP |
| `payments.clearing` | Accepted obligations and participant positions | Mojaloop/scheme |
| `payments.settlement` | Gross/net, immediate/deferred settlement | Mojaloop/scheme |
| `payments.reconciliation` | Agreement among provider, settlement and merchant records | OSS + accounting model |
| `finance.ledger` | Journal entries, economic effects and balancing | Accounting owner |
| `payments.orchestration.hyperswitch` | Provider routing, retry and connector representation | Hyperswitch |
| `payments.billing.killbill` | Billing/payment/account representation | Kill Bill |
| `payments.scheme.mojaloop` | FSPIOP, hub and settlement representation | Mojaloop |
| `payments.provider.stripe` | Stripe payment/refund/dispute states | Stripe docs |
| `payments.regulation.eu` | Jurisdiction-qualified PSD2 payment-service Claims | EU legislature |

Module boundaries remain hypotheses until source and code extraction prove that each vocabulary is coherent.

## 6. Source portfolio and authority contract

### Source classes

| Source class | Can establish | Cannot establish |
|---|---|---|
| EU legislation/regulator | EU jurisdiction duties and definitions | Provider implementation behavior |
| Issuing-body protocol/spec | Protocol message/state semantics | Product promises or legal compliance |
| Mojaloop official spec/code/tests | Mojaloop/FSPIOP and implementation behavior | Universal card/payment truth |
| Hyperswitch code/docs/tests | Hyperswitch orchestration and connector behavior | Provider/network obligations |
| Kill Bill code/docs/tests | Kill Bill billing/payment behavior | Universal settlement/accounting rules |
| Stripe official docs/API | Stripe-scoped payment/refund/dispute behavior | Other providers or universal law |
| Enterprise source code | Exact implementation behavior at one commit | Product intent or universal semantics |
| Enterprise policy/owner confirmation | Product commitment and responsibility | Regulation or provider behavior |
| Event schemas/telemetry | Observable fields and completeness evidence | Domain truth by themselves |

### Mandatory source record

Every source entry binds:

- source ID, kind, title and issuing authority;
- exact URL/repository/commit/tag;
- content digest or link-only reason;
- publication/release date and recorded time;
- license and redistribution decision;
- provenance and original locator;
- authority scopes;
- supported Claim families;
- known conflicts;
- archival/update strategy.

### Snapshot policy

| Decision | Treatment |
|---|---|
| License permits redistribution | Store exact snapshot bytes plus digest |
| Link permitted, redistribution unclear | Store metadata, digest if legally fetched, and canonical URL |
| Proprietary enterprise code | Store only in enterprise workspace; public artifact carries no bytes |
| Regulation | Store official locator and authorized snapshot/derived excerpt policy |
| Generated synthetic fixture | Mark repository-authored CC0 and preserve generation provenance |

No source enters a Published Release before license disposition.

### Mandatory Source Coverage Matrix

P0 does not pass by counting sources. Every in-scope lifecycle stage and Claim family must have one row
that records:

- the exact source and revision;
- issuer/maintainer and independent implementation lineage;
- the source's authority scope;
- the precise inference the source permits;
- inferences that remain forbidden;
- snapshot, excerpt or link-only disposition;
- license/redistribution status;
- expected absence or honest-refusal behavior;
- any additional evidence surface needed from schema, code, tests, release notes or conformance runs.

Three forks, adapters or repositories that inherit one implementation lineage count as one
representation. Missing applicable primary evidence for clearing, settlement or reconciliation is a P0
no-go even if intent, authorization and transfer sources are abundant.

## 7. Enterprise-code ingestion contract

Enterprise code is attached only after the public baseline compiles.

### Allowed inputs

- pinned Git commit;
- OpenAPI/AsyncAPI/GraphQL/Protobuf definitions;
- domain enums and state machines;
- database migrations/schema;
- event definitions;
- provider connector adapters;
- reconciliation jobs;
- configuration schemas;
- tests and synthetic fixtures;
- runbooks and authorized product policies.

### Forbidden inputs

- production user/payment data;
- credentials, keys or secrets;
- unrestricted runtime logs;
- code without owner authorization;
- generated summaries without source locators.

### Extraction pipeline

```text
repository convention discovery
  → symbol/schema/event inventory
  → candidate Model Contexts
  → candidate Concepts and state transitions
  → candidate descriptive Claims
  → public↔enterprise Mapping suggestions
  → owner review only for disputed boundaries
  → immutable enterprise Module Release
```

Every extracted item includes:

- repository and commit;
- exact file/symbol/line or schema pointer;
- extractor version;
- extraction confidence;
- whether it is a definition, implementation behavior, test expectation or observation;
- review status.

Code extraction creates proposals, never automatic Published truth.

## 8. Low-human-cost workflow

| Step | Automated work | Required human judgment | Why judgment remains |
|---|---|---|---|
| Source discovery | detect official releases, URLs, tags and changes | approve issuer and authority class | same topic does not imply same authority |
| License inventory | detect SPDX/license files and snapshot feasibility | resolve ambiguous redistribution | legal interpretation cannot be guessed |
| Schema/code extraction | parse APIs, enums, transitions and tests | choose Model Context boundaries | code layout is not domain ownership |
| Claim proposal | generate locators and candidate statements | approve identity/meaning-changing Claims | extraction cannot establish referent |
| Mapping proposal | compare names, shapes and transitions | approve identity/translation/realization | equal fields do not prove equal meaning |
| Conflict detection | surface incompatible Claims and versions | preserve or resolve with explicit role | majority vote is not authority |
| Coverage | derive missing/unknown/contested/unobservable | approve Scope changes | deleting hard areas must not improve Coverage |
| Closure | compile identity/time/observation blockers | narrow question or improve observations | system must not guess through gaps |
| Bench generation | derive predicates and mutant suggestions | approve utility and failure semantics | observable proxy may not represent utility |
| Qualification | freeze/execution/unseal/replay automation | independent Curator and reviewer | prevents author-visible answer tuning |
| Maintenance | detect source/code drift and affected assets | publish/supersede/withdraw Releases | support lifecycle is governance |

Human effort is measured per stage, not reduced to one automation percentage.

## 9. Delivery phases

### P0 — Scope and source-feasibility freeze

Actions:

1. Freeze the v0.1 Scope Declaration and exclusions.
2. Build a primary-source and license inventory.
3. Build the mandatory Source Coverage Matrix for every core lifecycle stage and Claim family.
4. Verify implementation independence by lineage, maintainer and evidence surface—not repository count.
5. Identify the official normative, schema/protocol, implementation, test/conformance and evolution
   evidence needed for every Claim family.
6. Record source gaps, forbidden inferences and legal-review requirements.

Outputs:

- `scope.yaml`;
- `sources/index.yaml`;
- source/license matrix;
- Source Coverage Matrix;
- authority-scope matrix;
- go/no-go report.

Gate:

- no unresolved source provenance or redistribution blocker for the core Modules;
- applicable primary evidence for every core family from intent through settlement and reconciliation;
- no unresolved clearing/settlement/reconciliation source gap;
- otherwise narrow or stop before modeling.

### P1 — Public source pack and implementation inventory

Actions:

1. Snapshot or link exact Mojaloop, Hyperswitch, Kill Bill, Stripe and EU sources.
2. Pin repository tags/commits and record licenses.
3. Parse official schemas, enums and state/event models.
4. Inventory public tests and reusable fixtures.
5. Record documented implementation divergences.

Outputs:

- immutable source pack;
- code/schema locator index;
- implementation comparison;
- proposed Module boundaries;
- friction ledger v1.

Gate:

- public Claims remain attributable to exact sources;
- vendor and regulation scopes cannot substitute.

### P2 — Semantic Modules and Claim ledger

Actions:

1. Model Concepts, identities, relations, events, states and invariants.
2. Create descriptive, normative, practice and hypothesis Claims.
3. Bind applicability, source authority, valid time and recorded time.
4. Preserve conflicts, unknowns and unobservable Claims.
5. Publish exact candidate Module Releases.

Outputs:

- public Modules;
- Claim ledger;
- terminology/conflict register;
- exact Release digests;
- reviewer/maintainer responsibilities.

Gate:

- every in-scope state/event/value distinction has a place;
- no Claim lacks provenance or authority scope;
- public tests do not promote Claims.

### P3 — Cross-implementation Mappings and Landscape

Actions:

1. Map generic payment Concepts to Mojaloop, Hyperswitch, Kill Bill and Stripe.
2. Distinguish identity, realization, translation, specialization and overlap.
3. Mechanically derive affected Mappings from split/supersede changes.
4. Compile the first Public Payment Landscape.
5. Generate source and implementation divergence reports.

Outputs:

- typed Mappings;
- Mapping review receipts;
- Landscape Release;
- impact report;
- unresolved mapping register.

Gate:

- a source custodian or evidence reviewer for each endpoint context reviews Mapping meaning; this does
  not require an external upstream maintainer to join the project review;
- no provider representation collapses into the generic model.

### P4 — Enterprise extraction and mapping pilot

Actions:

1. Select one authorized enterprise payment repository.
2. Run convention/schema/state/event extraction at an exact commit.
3. Create enterprise implementation Modules.
4. Map them to the public Landscape.
5. Record product-specific commitment and jurisdiction inputs as proposals only.

Outputs:

- enterprise Module Releases;
- enterprise/public Mappings;
- Source Authority/owner receipts;
- friction ledger v2.

Gate:

- every enterprise asset remains under the dedicated non-Git enterprise runtime root;
- pack/path negative checks find no enterprise path, bytes, policy locator or derived artifact in the
  public root or public package;
- owner intervention is limited to material identity, authority and policy questions.

### P5 — Exact enterprise View, Contract and Observation Profile

Actions:

1. Create an exact enterprise View from pinned public and enterprise Releases and Mappings.
2. Bind product-specific commitments and jurisdiction into a Product Contract over that View.
3. Create the Observation Profile against the exact Contract and only synthetic observations.
4. Verify the Contract cannot refer to Modules or Claims outside its View.

Outputs:

- exact enterprise View;
- Product Contract;
- Observation Profile;
- synthetic observation fixtures;
- negative public-package leakage evidence.

Gate:

- View precedes and fully bounds the Product Contract;
- Product Contract precedes and fully bounds the Observation Profile;
- no enterprise asset or locator enters the public root or package.

### P6 — Bitemporal Views and Coverage

Actions:

1. Create provider/jurisdiction/product Views.
2. Reconstruct historical valid-time and knowledge-time states.
3. Derive multidimensional Coverage.
4. Exercise one source update, provider change and Concept split.
5. Verify impact propagation without global graph activation.

Outputs:

- exact Views;
- bitemporal replay cases;
- Coverage reports;
- evolution/impact evidence;
- maintenance friction report.

Gate:

- missing, unknown, contested, unobservable and out-of-scope remain distinct;
- Projection exclusions cannot improve Domain Coverage.

### P7 — Observation Contracts and Evaluation Closure

Actions:

1. Bind cross-system payment/attempt/refund/settlement/ledger identities.
2. Define business time, event time, observation time and lateness.
3. Define webhook/feed/ledger completeness.
4. Define absence and missing-evidence semantics.
5. Compile a complete Closure and multiple refusal Closures.

Required refusals:

- provider webhook/feed completeness unavailable;
- settlement or ledger reconciliation identity not closed;
- Claim conflict/applicability unresolved.

Outputs:

- Observation Profiles;
- complete/refused Closures;
- blocker evidence;
- Closure digest and replay.

Gate:

- no hard verdict can proceed through an unresolved blocker.

### P8 — Baseline Bench family

Bench families:

1. intent/authorization/capture state conformance;
2. amount/currency/value conservation;
3. partial/full/cumulative refund;
4. retry versus economic exactly-once;
5. provider-neutral/provider-specific mapping;
6. refund versus dispute/chargeback distinction;
7. clearing position and settlement obligation;
8. ledger reconciliation;
9. bitemporal late evidence;
10. Closure refusal semantics.

For each Grade Atom define:

- target Claim;
- utility claim;
- deterministic estimator;
- validity bounds;
- consumer/action;
- calibration plan;
- repeatability contract;
- observation and absence semantics.

Outputs:

- public development/calibration/validation cohorts;
- Gold/equivalent/mutant cases;
- grader digest;
- false-accept/false-reject evidence;
- artifact-only validation Run.

Gate:

- public labels can produce only `validated`, never `qualified`;
- exactly-once is based on economic effect, not attempt count.

### P9 — Independent qualification

Actions:

1. Freeze exact source revision, Closure and grader.
2. Runtime verifier confirms Curator assignment and candidate-scoped acceptance.
3. Candidate freezes all visible and retired case IDs and observation digests.
4. Curator creates unseen label-free holdout.
5. Frozen grader executes and persists predictions.
6. Curator independently unseals labels.
7. Admission revalidates freeze, authority, non-reuse and result vectors.
8. Replay from the single immutable qualification Run.

Outputs:

- candidate, freeze, execution, unseal and Run receipts;
- admitted or rejected status;
- canonical replay evidence.

Gate:

- no runtime-verifiable Curator authority means no qualification;
- no third-party reviewer approval means no public promotion.

### P10 — Contributor journey and maintenance trial

Actions:

1. Give a clean contributor only public docs, tools and one source task.
2. Ask them to add or revise a Claim/Mapping without oral help.
3. Introduce a source version change and implementation drift.
4. Measure discovery, review, rework and maintenance friction.
5. Classify each friction event with a narrow/stop/automate/retain-human decision.
6. Remove workflow steps that do not protect a real risk.

Outputs:

- contributor receipt;
- friction ledger v3;
- usability findings;
- support/archive policy;
- M5 promotion decision packet.

Gate:

- a contributor can make a provenance-bound contribution;
- maintainers can understand impact and refuse unsafe publication;
- no silent manual knowledge is required.

## 10. Artifact layout

```text
packages/weave/examples/public-payments-landscape/
├── scope.yaml
├── sources/
│   ├── index.yaml
│   └── snapshots-or-link-records/
├── modules/
├── mappings/
├── landscapes/
├── bench/
│   ├── development/
│   ├── calibration/
│   └── validation/
├── governance/
│   ├── authority-matrix.yaml
│   ├── conflict-register.yaml
│   ├── evolution-ledger.yaml
│   └── friction-ledger.yaml
└── README.md

/Users/slipshod/AIBuild/dsh-eval-lab-runtime/enterprise-payments/{enterprise-id}/
├── sources/
├── code-index/
├── modules/
├── mappings/
├── views/
├── product-contracts/
├── observations/
├── episodes/
├── validation/
└── qualification/
    ├── candidate.json
    ├── curator-cases.yaml
    ├── freeze.json
    ├── execution.json
    ├── curator-expectations.yaml
    ├── unseal.json
    └── qualification-run.json
```

Runtime receipts and holdout artifacts remain outside the source repository until unseal/publication is
explicitly approved.

## 11. Friction ledger

Record one entry whenever manual work or rework occurs:

```yaml
friction_id:
phase:
actor_role:
artifact_ref:
trigger:
missing_information:
decision_required:
alternatives_considered:
resolution:
rework:
automation_candidate:
automation_risk:
evidence_refs:
```

Report per-stage observations:

- source discovery and license effort;
- Claims proposed versus materially rewritten;
- Mapping suggestions accepted/rejected;
- unresolved authority/conflict count;
- Closure blocker categories;
- contributor questions and oral-help dependence;
- source update and impact-review effort.

These are diagnostics, not one total score.

### Friction decision table

| Finding | Required disposition |
|---|---|
| Core Claim family lacks an applicable primary source | Stop or narrow Scope before modeling |
| Redistribution is ambiguous | Use an authorized link-only record, otherwise stop |
| Public modeling requires enterprise code or policy | Architecture failure; do not import it |
| Closure depends on unavailable evidence | Emit an honest refusal |
| Contributor needs unrecorded oral context | Do not recommend public promotion |
| Repeated mechanical rework | Create an automation/harness candidate |
| Automation would hide authority judgment | Retain explicit human review |

## 12. Roles

| Role | Responsibility |
|---|---|
| Public source Curator | Source identity, license and snapshots |
| Module Maintainer | Scope, semantic coherence and Releases |
| Mapping Reviewer | Cross-context relation meaning |
| Legal/Regulatory Reviewer | Jurisdiction-scoped normative Claims only |
| OSS Implementation Reviewer | Code/schema interpretation at exact revision |
| Enterprise Owner | Product policy and implementation responsibility |
| Landscape Curator | Exact public composition |
| Eval Owner | Projection, Closure and Grade Atoms |
| Qualification Curator | Unseen holdout and label unseal |
| Independent Reviewer | Final candidate and receipt review |

One person may hold multiple roles except where qualification/review independence forbids it.

## 13. Stop conditions

Stop, narrow or defer the pilot if:

- core source or fixture licenses cannot support public reproducibility;
- there are not at least three genuinely independent implementation representations;
- settlement/reconciliation cannot be modeled from public sources without proprietary rules;
- legal Claims require interpretation the project cannot independently review;
- enterprise code is necessary to establish the public base;
- no complete Closure can be produced from synthetic observations;
- the Bench merely mirrors one provider API;
- manual review expands beyond material identity/authority/policy decisions;
- the active surface becomes an unbounded union of versions;
- qualification cannot remain independent.

## 14. M5 decision packet

M5 asks whether the proven internal model should expose any public Schema/API/CLI.

Required evidence:

- source/license gate passed;
- public Landscape and exact Releases;
- multiple real OSS representations;
- complete and refused Closures;
- multidimensional Coverage;
- validated public Bench;
- independently qualified Run;
- clean contributor receipt;
- evolution/maintenance trial;
- proportional public regression/build/pack evidence;
- independent final review.

M5 may still choose to keep the compiler internal if the object boundaries or contribution workflow remain
unstable.
