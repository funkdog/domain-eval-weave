---
feature_ids: []
topics: [payments, kill-bill, scope-declaration, orchestration, recovery]
doc_kind: scope-declaration
created: 2026-09-02
version: 0.2.0
status: accepted-scope
decision_provenance: thread_msx25fw48rony7bs
content_review:
  verdict: approve
  reviewer_id: cat-iebdnvwv
  message_id: 0001788335531260-000427-10d4dbf8
  reviewed_head: 725fbcae5a379197428ba993974c6f33a9356e2f
scope_acceptance:
  accepted_at: 2026-09-02
  operator_message_id: 0001788338709298-000011-6957e684
  gate: all-six-items
---

# Kill Bill Payment Orchestration & Recovery Scope Declaration v0.2

## 1. Purpose and status

This document freezes only the candidate Model Context and its evidence boundary. It is the first
domain-onboarding checkpoint, not the completed domain model.

The Scope acceptance gate in section 10 was approved by the operator on 2026-09-02 after an independent
content review returned `APPROVE`. This acceptance authorizes the Source Feasibility Matrix stage only.

It does not yet contain or authorize:

- the complete Semantic Model;
- business-process and state-machine definitions;
- a Claim Ledger or epistemic promotion;
- a Domain Release, Landscape, View or Product Contract;
- an Eval Projection, Closure, grader or Bench.

The next stage may begin only after the operator accepts this scope and the content review closes.

## 2. Candidate identity

| Field | Candidate value |
| --- | --- |
| Model Context | `payments.orchestration.killbill` |
| Subject | Kill Bill direct-payment orchestration and incomplete-state recovery |
| Primary implementation | Kill Bill `0.24.21` |
| Exact implementation commit | `5da9650de60b2fa83dea556d7e95c70b79dabd39` |
| Documentation revision | `9ef10c7237c4300dbe10a4308bb3c24906e0c74e` |
| Test-provider artifact | Payment Test Plugin `8.0.1` |
| Channel | Direct Payment API, payment-method routing and payment-plugin boundary |
| Jurisdiction | None; jurisdiction-specific obligations require separate Modules or Product Contracts |

The scope question is:

> Given a direct payment operation and the status reported through a selected payment plugin, what
> transaction state does Kill Bill record, which subsequent orchestration actions are available, and how
> may an incomplete state be revisited without pretending that external funds have settled?

Completeness is relative to this question. Every material identity, operation family, result category,
recovery path, responsibility transfer and known uncertainty inside it must eventually have a place in
the Semantic and Behavioral Models.

## 3. Included boundary

The candidate Module will model:

- the association between a Kill Bill `Account`, `PaymentMethod` and registered payment-plugin name;
- `Payment` as an orchestration aggregate containing one or more independently identified
  `PaymentTransaction` records;
- the direct-operation families `AUTHORIZE`, `PURCHASE`, `CREDIT`, `CAPTURE`, `VOID` and `REFUND`;
- state-dependent availability of subsequent operation families;
- translation of plugin outcomes into `SUCCESS`, `PENDING`, `PAYMENT_FAILURE`, `PLUGIN_FAILURE` and
  `UNKNOWN` transaction statuses;
- explicit completion of an eligible pending transaction;
- notification-queue and on-the-fly Janitor re-observation of incomplete state;
- caller-provided correlation/idempotency keys, including their operation-specific scope and exceptions;
- the responsibility boundary between merchant application, Kill Bill core, payment plugin and external
  payment provider.

No included item is a Claim yet. Inclusion means that the next source and modeling stages must either
close it or return here and narrow the scope.

## 4. Adjacent boundary

These subjects remain visible but will not be modeled as part of this Module:

- invoices, subscriptions, overdue policy and invoice-payment coordination;
- payment-control plugins, product retry schedules and account-entitlement policy;
- hosted payment pages, 3-D Secure and checkout UX;
- provider-specific amount, currency, instrument, mandate and capture-limit rules;
- `CHARGEBACK` and chargeback-reversal recording as a pair;
- the external dispute, representment, arbitration and liability lifecycle;
- provider balances, fees, reserves and payouts;
- clearing, settlement, bank receipt, reconciliation and general-ledger posting;
- fraud, KYC/KYB, AML, sanctions, PCI and jurisdiction-specific compliance.

`CHARGEBACK` is not half-included: its recording operation and reversal exception move together to an
adjacent Model Context until their source and lifecycle boundary can be closed.

## 5. Explicit non-claims

This Module must never be used by itself to claim:

- that a payer, account, card, token or mandate is genuine;
- that an issuer, acquirer or payment network actually authorized an operation;
- that cumulative capture cannot exceed authorization;
- that a retry produced exactly one external economic effect;
- that a Kill Bill `SUCCESS` proves clearing, settlement, payout or bank receipt;
- that balances, fees, reserves or foreign-exchange amounts reconcile;
- that a refund or dispute satisfies provider, network or legal rules;
- that an implementation is compliant with any jurisdiction or security standard.

## 6. Responsibility boundary

| Actor | Responsibility considered by this scope | Authority that remains outside |
| --- | --- | --- |
| Merchant application | Select account, payment method, operation, amount, currency and caller keys | Provider acceptance, settlement and product policy correctness |
| Kill Bill core | Route by payment method, persist orchestration state, apply configured transition logic and invoke incomplete-state recovery | Provider business rules and external economic finality |
| Payment plugin | Translate an operation to one provider and report provider-facing status | Universal behavior of other providers or payment networks |
| External provider/network | Decide and execute the external operation under its own contract | Kill Bill persistence and recovery behavior |
| Clearing/settlement/accounting systems | Move, settle, pay out and reconcile value | Kill Bill transaction status by themselves |

A Kill Bill `SUCCESS` means only that the selected integration path reported success and Kill Bill
committed the corresponding orchestration state. It is not a financial or accounting closure.

## 7. Identity guardrails

The later Semantic Model must preserve these boundaries:

- a `PaymentTransaction` UUID is the canonical identity of the Kill Bill transaction entity;
- a transaction external key is caller-provided correlation/idempotency data, not entity identity;
- external-key behavior is scoped by operation and includes special handling outside this Module, such as
  chargeback reversal, so no universal uniqueness rule may be inferred here;
- a Kill Bill Payment UUID, transaction UUID, provider transaction reference, clearing instruction,
  settlement item, payout item and bank-statement line remain distinct identities;
- equal amounts, timestamps or strings do not establish cross-system identity;
- cross-system identity requires a separately reviewed Mapping and Observation Contract.

## 8. Evidence and authority guardrails

The next Source Feasibility Matrix must distinguish:

```text
official documentation  → declared Kill Bill behavior
exact code/config       → implemented Kill Bill behavior
maintainer tests        → expected implementation behavior
runtime observation     → behavior of one exact execution
provider contract       → provider-scoped behavior only
financial evidence      → clearing, settlement, payout or reconciliation only
```

No evidence class substitutes for another. In particular:

- a provider document cannot confirm a Kill Bill implementation statement;
- Kill Bill code cannot confirm a provider or settlement statement;
- an unpersisted runtime observation cannot become a grounded Claim;
- schema validity, local success and source count cannot publish domain truth.

Primary static anchors already identified for the next stage are:

- [payment states and Janitor documentation](https://github.com/killbill/killbill-docs/blob/9ef10c7237c4300dbe10a4308bb3c24906e0c74e/userguide/payment/includes/payment-states.adoc);
- [direct payment API documentation](https://github.com/killbill/killbill-docs/blob/9ef10c7237c4300dbe10a4308bb3c24906e0c74e/userguide/payment/includes/payment-apis.adoc);
- [payment-method and plugin-routing documentation](https://github.com/killbill/killbill-docs/blob/9ef10c7237c4300dbe10a4308bb3c24906e0c74e/userguide/payment/includes/payment-methods-and-plugins.adoc);
- [`PaymentStates.xml` at the exact implementation commit](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/resources/org/killbill/billing/payment/PaymentStates.xml);
- [`PaymentProcessor.java` at the exact implementation commit](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/java/org/killbill/billing/payment/core/PaymentProcessor.java);
- [Payment Test Plugin `8.0.1`](https://repo1.maven.org/maven2/org/kill-bill/billing/plugin/java/payment-test-plugin/8.0.1/), JAR SHA-256
  `abbe777d512eb7f7e11443bd073500ae35d4c618c841408a921f3277c8b32774`.

These anchors are candidates for the Source Matrix, not a completed source-coverage claim.

## 9. Preliminary feasibility observations

The 2026-09-02 synthetic preflight established only that this candidate is practical to investigate:

- the exact Kill Bill and MariaDB images ran natively on Apple Silicon;
- the core, database, OSGi, plugin and queue health checks were healthy;
- the run observed all five result-status categories and two incomplete-state completion paths;
- direct purchase, authorize, partial capture and one built-in external-payment refund path executed;
- one caller-key collision was rejected on the tested successful direct-payment path.

The preflight deliberately left no persistent request/response bundle. These observations are therefore
`preliminary`, not replay evidence and not grounded Claims.

Two preliminary counterexamples must be reproduced and preserved before Claim promotion:

1. Built-in `__EXTERNAL_PAYMENT__` accepted cumulative capture `31.00` after authorization `30.00`.
   This is a reason not to invent a universal capture-limit invariant; it does not yet prove the general
   mechanism or the behavior of other plugins.
2. Payment Test Plugin `8.0.1` failed its refund path. Exact artifact source constructs the refund result
   with null amount and currency, while its DAO dereferences currency when persisting the response:
   [refund source](https://github.com/killbill/killbill-payment-test-plugin/blob/3b7e5eb97b81a00f98c66316bbd371bea38999d5/src/main/java/org/killbill/billing/plugin/payment/PaymentTestPluginApi.java#L428-L450),
   [DAO source](https://github.com/killbill/killbill-payment-test-plugin/blob/3b7e5eb97b81a00f98c66316bbd371bea38999d5/src/main/java/org/killbill/billing/plugin/payment/dao/PaymentTestDao.java#L55-L82).

The static plugin defect may be grounded during the source stage. The runtime occurrence remains
preliminary until captured in an immutable, replayable observation artifact.

## 10. Scope acceptance gate

Accepting this declaration means agreeing that:

1. the first Kill Bill Module describes direct-payment orchestration and incomplete-state recovery;
2. provider rules and financial closure are explicit external dependencies, not missing Kill Bill Claims;
3. chargeback and reversal remain adjacent together for this release;
4. transaction UUID and external key are different identity concepts;
5. preliminary runtime observations may guide source work but cannot ground Claims;
6. the next artifact is a Source Feasibility Matrix, not a Claim Ledger or Bench.

If any included operation or recovery family lacks applicable primary evidence, the correct result is to
narrow this scope before modeling.

## 11. Next stage after acceptance

The next stage will produce a source-coverage and authority matrix for each included family. Only after
that gate passes will the same evolving Module candidate add:

```text
Semantic Model
  → Concepts, identity, relations and definitional invariants
Behavioral Model
  → Commands, events, states, transitions, time and failure flows
Claim Ledger
  → Qualified propositions over that model with provenance and epistemic state
```

Those later sections are intentionally absent from this Scope Declaration.
