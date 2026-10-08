---
feature_ids: []
topics: [payments, kill-bill, source-feasibility, authority, granularity]
doc_kind: source-feasibility-matrix
created: 2026-09-02
version: 0.1.0
status: accepted-source-feasibility
decision_provenance: thread_msx25fw48rony7bs
scope_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-scope-declaration.md
  accepted_commit: 177d892e488f3304ddf0a1201ff4eaba9a5c0181
  operator_message_id: 0001788338709298-000011-6957e684
stage_authorization:
  authorized_at: 2026-09-02
  operator_message_id: 0001788341725109-000061-2bd763ba
  disposition: accept-go-with-conditions-and-keep
  authorized_next_stage: semantic-model
source_deltas:
  - source_id: KB-COMMONS-0.26.15
    added_at: 2026-09-03
    reason: behavioral extraction requires the exact automaton link-state engine
---

# Kill Bill Payment Orchestration Source Feasibility Matrix v0.1

## 1. Decision and boundary

This matrix asks whether every family included by the accepted
`payments.orchestration.killbill` Scope has applicable primary evidence before semantic modeling begins.
It does not create Concepts, state machines, Claims or evaluation assets.

The operator accepted `GO_WITH_CONDITIONS + KEEP` and authorized the Semantic Model stage on 2026-09-02.
That authorization does not extend to the Behavioral Model, Claim Ledger or Bench.

Overall disposition:

```text
source feasibility: GO_WITH_CONDITIONS
module granularity: KEEP
claim promotion:    NOT_AUTHORIZED
runtime hard grade: NOT_READY
```

All included families have exact Kill Bill documentation, contract, implementation or maintainer-test
surfaces. Three limitations remain mandatory inputs to later stages:

1. the documentation revision is exact but is not tagged to the core release;
2. external-key behavior is operation- and outcome-dependent, not one universal invariant;
3. Payment Test Plugin `8.0.1` cannot serve as a successful-refund runtime oracle.

These conditions do not prevent modeling Kill Bill's implementation-specific language. They do prevent
unqualified Claims and hard runtime verdicts.

## 2. Exact source portfolio

2026-09-06 packaging update: `../sources/index.yaml` pins six local JSON bundles containing 39 verbatim
upstream files (including each repository's LICENSE). Each file's byte length and Git blob SHA-1 were
checked against the exact upstream Git tree; bundle SHA-256 values are verified offline. The portfolio
below retains the original discovery disposition. Local snapshots are a selected subset, not entire
repositories; unbundled test references remain exact external links. R1 and the test-plugin JAR are not
promoted to replay evidence.

PURCHASE timeout walkthrough update: the same core snapshot now also contains
`IncompletePaymentTransactionTask.java`, `PurchaseOperation.java` and `PurchaseInitiated.java` from the
same pinned commit. The package now has 42 upstream files. These three files close the previously
uninspected local recovery/update and PURCHASE-dispatch branches; they are source evidence, not a runtime
experiment. Their original contents, byte lengths and upstream Git blob identities are retained.

| Source ID | Exact identity | Evidence class | Authority scope | License and disposition |
| --- | --- | --- | --- | --- |
| `KB-DOC-9EF10C7` | [`killbill-docs@9ef10c7237c4300dbe10a4308bb3c24906e0c74e`](https://github.com/killbill/killbill-docs/tree/9ef10c7237c4300dbe10a4308bb3c24906e0c74e) | Maintainer documentation | Declared Kill Bill behavior at that documentation revision | Apache-2.0; snapshot-eligible, currently exact links only |
| `KB-CORE-0.24.21` | [`killbill-0.24.21@5da9650de60b2fa83dea556d7e95c70b79dabd39`](https://github.com/killbill/killbill/tree/5da9650de60b2fa83dea556d7e95c70b79dabd39) | Core code, configuration and tests | Implemented and maintainer-expected behavior for exact release | Apache-2.0; snapshot-eligible, currently exact links only |
| `KB-API-0.54.0` | [`killbill-api-0.54.0@5c6081268eb1860902fc926c39437514350c3068`](https://github.com/killbill/killbill-api/tree/5c6081268eb1860902fc926c39437514350c3068) | Public Java contract | Payment, transaction, type and status contract used by the core release | Apache-2.0; snapshot-eligible |
| `KB-PLUGIN-API-0.27.3` | [`killbill-plugin-api-0.27.3@91946ce9d0f6bc0a4c5a37a2c58b2d87a5e69257`](https://github.com/killbill/killbill-plugin-api/tree/91946ce9d0f6bc0a4c5a37a2c58b2d87a5e69257) | Provider-adapter port | Operations Kill Bill delegates to a payment plugin | Apache-2.0; snapshot-eligible |
| `KB-PARENT-0.146.87` | [`killbill-oss-parent-0.146.87@056243fc77fff8913a718507a22a9c509a7c12f9`](https://github.com/killbill/killbill-oss-parent/tree/056243fc77fff8913a718507a22a9c509a7c12f9) | Dependency lock | Binds `KB-API-0.54.0` and `KB-PLUGIN-API-0.27.3` to core `0.24.21` | Apache-2.0; exact link and Maven POM |
| `KB-COMMONS-0.26.15` | [`killbill-commons-0.26.15@fbd602c19f662be6a6b7e524c4cba059ab8bff33`](https://github.com/killbill/killbill-commons/tree/fbd602c19f662be6a6b7e524c4cba059ab8bff33) | Automaton implementation | Executes operation results, transition lookup and link-state-machine traversal used by core `0.24.21` | Apache-2.0; snapshot-eligible |
| `KB-TEST-PLUGIN-8.0.1` | [`payment-test-plugin-8.0.1@3b7e5eb97b81a00f98c66316bbd371bea38999d5`](https://github.com/killbill/killbill-payment-test-plugin/tree/3b7e5eb97b81a00f98c66316bbd371bea38999d5), [Maven artifact](https://repo1.maven.org/maven2/org/kill-bill/billing/plugin/java/payment-test-plugin/8.0.1/) | Configurable test adapter | Test-plugin behavior only; never universal provider behavior | Apache-2.0 POM; JAR SHA-256 `abbe777d512eb7f7e11443bd073500ae35d4c618c841408a921f3277c8b32774` |
| `R1` | 2026-09-02 synthetic Apple-Silicon preflight | Preliminary runtime observation | Feasibility and hypothesis generation only | No retained raw artifact; cannot be snapshotted, replayed or promoted |

The core POM inherits `killbill-oss-parent:0.146.87`, which pins `killbill-api:0.54.0`,
`killbill-plugin-api:0.27.3` and `killbill-commons:0.26.15`. These are one release dependency chain rather
than guessed compatible versions.

The docs, API, core, tests and test plugin are multiple evidence surfaces but remain one Kill Bill
maintainer ecosystem. They do not count as independent payment-industry representations.

## 3. Documentation applicability

`KB-DOC-9EF10C7` is an exact commit whose changelog update names Kill Bill `0.24.21`, but the docs
repository publishes from a rolling `v3` branch and has no matching `0.24.21` tag. Therefore:

- docs may establish what the maintainers declared at that exact revision;
- exact-version implementation behavior must also bind `KB-CORE-0.24.21` and its locked APIs;
- disagreement between docs and code must be preserved as conflict, not resolved by silently preferring
  either source;
- later source snapshots must record both publication time and applicability evidence.

Disposition: usable with exact commit and code concurrence; not a floating `latest` source.

## 4. Included-family coverage

| Family | Exact primary evidence | Permitted inference | Forbidden inference | Gap / conflict | Verdict |
| --- | --- | --- | --- | --- | --- |
| `F01 account-payment-method-routing` | [routing docs](https://github.com/killbill/killbill-docs/blob/9ef10c7237c4300dbe10a4308bb3c24906e0c74e/userguide/payment/includes/payment-methods-and-plugins.adoc); [`PaymentMethodProcessor`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/java/org/killbill/billing/payment/core/PaymentMethodProcessor.java); [`DefaultPaymentProviderPluginRegistry`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/java/org/killbill/billing/payment/provider/DefaultPaymentProviderPluginRegistry.java); [payment-method tests](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/core/TestPaymentMethodProcessorWithDB.java) | Kill Bill stores/selects a plugin name for a PaymentMethod and dispatches through the registered service | Payment instrument validity, ownership or provider acceptance | Payment-control routing remains adjacent | `covered` |
| `F02 payment-transaction-identity` | [payment-state docs](https://github.com/killbill/killbill-docs/blob/9ef10c7237c4300dbe10a4308bb3c24906e0c74e/userguide/payment/includes/payment-states.adoc); [`Payment`](https://github.com/killbill/killbill-api/blob/5c6081268eb1860902fc926c39437514350c3068/src/main/java/org/killbill/billing/payment/api/Payment.java); [`PaymentTransaction`](https://github.com/killbill/killbill-api/blob/5c6081268eb1860902fc926c39437514350c3068/src/main/java/org/killbill/billing/payment/api/PaymentTransaction.java); [`TestPaymentApi`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/api/TestPaymentApi.java) | A Payment groups transaction entities; UUID is entity identity and external key is a separate field | Identity with a provider transaction, settlement item or bank line | Cross-system identifiers require later Mappings | `covered` |
| `F03 initial-operations` | [direct API docs](https://github.com/killbill/killbill-docs/blob/9ef10c7237c4300dbe10a4308bb3c24906e0c74e/userguide/payment/includes/payment-apis.adoc); [`TransactionType`](https://github.com/killbill/killbill-api/blob/5c6081268eb1860902fc926c39437514350c3068/src/main/java/org/killbill/billing/payment/api/TransactionType.java); `PaymentProcessor`; `PaymentStates.xml`; [`testSanityAcrossTransactionTypes`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/api/TestPaymentApi.java#L2052-L2074) | Kill Bill exposes initial `AUTHORIZE`, `PURCHASE` and `CREDIT` transaction families | Provider support or economic equivalence between those operations | `CREDIT` meaning must stay Kill-Bill-specific | `covered` |
| `F04 capture` | direct API docs; [`PaymentPluginApi#capturePayment`](https://github.com/killbill/killbill-plugin-api/blob/91946ce9d0f6bc0a4c5a37a2c58b2d87a5e69257/payment/src/main/java/org/killbill/billing/payment/plugin/api/PaymentPluginApi.java); `PaymentStates.xml`; `TestPaymentApi` multiple-capture tests | Kill Bill supports one or more capture transactions and routes the requested amount/currency to the plugin | Cumulative capture limit, actual funds capture or provider support | R1 over-capture remains preliminary and cannot define the general mechanism | `covered_with_boundary` |
| `F05 void` | direct API docs; `PaymentPluginApi#voidPayment`; `PaymentStates.xml`; [`TestPaymentProcessor#testVoid`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/core/TestPaymentProcessor.java#L158-L178); auth/capture/void API tests | Kill Bill exposes VOID and records its state-machine outcome | Release of real authorization holds or provider timing rules | No retained R1 VOID observation; static evidence is sufficient for modeling | `covered_static` |
| `F06 refund` | direct API docs; `PaymentPluginApi#refundPayment`; `PaymentStates.xml`; [multiple-capture/refund tests](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/api/TestPaymentApi.java#L795-L843); exact test-plugin source | Kill Bill core exposes REFUND as a subsequent transaction and maintains its orchestration state | Provider refund eligibility, original-tender return or financial completion | Test Plugin `8.0.1` constructs null refund amount/currency and cannot be the success oracle | `covered_static_runtime_oracle_gap` |
| `F07 result-status-translation` | payment-state docs; [`TransactionStatus`](https://github.com/killbill/killbill-api/blob/5c6081268eb1860902fc926c39437514350c3068/src/main/java/org/killbill/billing/payment/api/TransactionStatus.java); [`PaymentTransactionInfoPluginConverter`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/java/org/killbill/billing/payment/core/PaymentTransactionInfoPluginConverter.java); success/failure/cancel/exception tests | Exact mapping from plugin status to Kill Bill transaction status and automaton result | External economic outcome from a Kill Bill status | `PAYMENT_SYSTEM_OFF` exists in API but is outside the accepted five-result scope and must remain visible as adjacent | `covered_with_adjacent_status` |
| `F08 explicit-pending-completion` | payment-state docs; [`TransactionResource#notifyStateChanged`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/jaxrs/src/main/java/org/killbill/billing/jaxrs/resources/TransactionResource.java); `PaymentProcessor#notifyPendingPaymentOfStateChanged`; completion tests | An eligible PENDING transaction can be completed as success or failure through the explicit API | That the caller possessed valid provider evidence | Caller authority/observation belongs to a future Product/Observation Contract | `covered` |
| `F09 janitor-recovery` | Janitor docs; [`Janitor`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/java/org/killbill/billing/payment/core/janitor/Janitor.java); incomplete-transaction task; [`TestJanitor`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/TestJanitor.java); [`testJanitorThroughGet`](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/api/TestPaymentApi.java#L2789-L2830) | Notification and on-the-fly Janitor re-query plugin information and may correct incomplete Kill Bill state | Provider truth when `getPaymentInfo` is incomplete or wrong; automatic economic retry | Product retry policy remains adjacent; Janitor recovery and retry are not synonyms | `covered` |
| `F10 external-keys` | direct API docs; Payment and PaymentTransaction APIs; `PaymentProcessor` collision logic; [`TestPaymentApi` key-sanity tests](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/test/java/org/killbill/billing/payment/api/TestPaymentApi.java#L2052-L2503) | Kill Bill exposes caller keys and applies outcome/operation-specific collision rules | External key as entity identity or universal exactly-once guarantee | Chargeback reversal has a special exception outside this Module; no one-sentence universal rule is safe | `covered_with_constraints` |
| `F11 amount-currency-propagation` | Payment/PaymentTransaction APIs; PaymentPluginApi operation signatures; `PaymentAutomatonDAOHelper`; operation tests | Kill Bill carries requested and processed amount/currency fields through its orchestration records | Conservation, capture ceilings, FX correctness, settlement or ledger balancing | Provider/product financial invariants are intentionally external | `covered_for_representation` |
| `F12 exception-and-unknown` | payment-state docs; `PaymentOperation`; converter; timeout/exception/null-result tests | Exceptions, timeouts and undefined/null plugin results create incomplete/error state that must not be treated as known failure or success | Whether an external operation actually occurred | Later provider evidence is required to close UNKNOWN | `covered` |

Legend:

- `covered` — applicable primary evidence exists for the included implementation-specific family;
- `covered_static` — docs/code/tests support modeling, but R1 did not observe the path;
- `covered_with_boundary` / `covered_with_constraints` — source coverage exists only with the stated
  non-claim preserved;
- `covered_static_runtime_oracle_gap` — semantic/behavioral modeling may proceed, but a hard runtime grade
  may not use the defective test oracle.

No family is currently `missing`. This does not mean any Claim is confirmed.

## 5. Evidence gaps and required treatment

| Gap ID | Gap | Risk if ignored | Required treatment | Blocks next stage? |
| --- | --- | --- | --- | --- |
| `G1 docs-release-alignment` | Docs commit is exact but not release-tagged | A rolling declaration could be misapplied to `0.24.21` | Bind code/API/tests for every version-specific statement and preserve conflicts | No, conditional |
| `G2 refund-runtime-oracle` | Payment Test Plugin `8.0.1` refund path is defective | A broken oracle could turn infrastructure failure into product failure | Use static core evidence for modeling; select or build an independently validated synthetic provider only at Closure/Bench time | No for modeling; yes for hard runtime grade |
| `G3 runtime-artifact-absence` | R1 has no retained request/response artifacts | Preliminary observations cannot be replayed or independently reviewed | Re-run later under an immutable Observation Contract before promotion | No for source modeling; yes for runtime-backed Claims |
| `G4 key-semantics-complexity` | Collision behavior varies by outcome and operation | A global idempotency Claim would be false | Model UUID identity first; defer qualified key Claims until behavioral extraction | No, conditional |
| `G5 provider-financial-invariants` | Kill Bill does not establish provider/financial rules | Orchestration state could be mistaken for value movement | Keep those rules in provider, settlement or Product Contract contexts | No; deliberately out of scope |
| `G6 adjacent-feature-leakage` | Invoice retry, payment control, chargeback and reversal share nearby code | The Module could silently expand while extracting sources | Path inclusion alone is insufficient; enforce the accepted capability list | No, guarded |

## 6. Granularity Decision Packet

### Evidence-based assessment

| Criterion | Evidence | Finding |
| --- | --- | --- |
| Language cohesion | All included families use Payment, PaymentTransaction, PaymentMethod, plugin status and the same operation vocabulary | `keep` |
| Identity cohesion | All included behavior updates or re-observes the same Payment/PaymentTransaction identities | `keep` |
| Lifecycle coupling | Janitor recovery consumes the same transaction state and plugin port used by direct operations | `keep` |
| Authority cohesion | All included descriptive behavior belongs to exact Kill Bill releases; provider and financial authority remain external | `keep` |
| Release cohesion | Core `0.24.21` explicitly pins API `0.54.0` and plugin API `0.27.3` through one parent release | `keep` |
| Independent consumer value | No consumer declared by the accepted Scope requires publishing Janitor or routing semantics without the Payment transaction model | no split evidence |
| Split mapping cost | Splitting routing, transaction state and recovery would require mandatory shared identity and transition Mappings | split cost high |

### Recommendation

```text
KEEP payments.orchestration.killbill as one candidate Model Context.
```

The Module is near its upper useful boundary but is not presently over-broad. It remains coherent because
all included behavior speaks one Kill Bill payment language, operates over one aggregate identity and is
versioned through one release dependency chain.

Do not merge these adjacent families into it:

- invoice/subscription payment policy;
- payment-control and product retry policy;
- chargeback plus reversal;
- provider-specific financial invariants;
- clearing, settlement, payout or accounting.

Re-run the Granularity Gate if any of these occurs:

- one included family requires a different source or governance authority;
- one term acquires a different referent or causal meaning;
- a family changes independently enough to require its own release cadence;
- downstream consumers need to select one family independently;
- most new Claims require cross-boundary joins;
- adding an adjacent family introduces chargeback, invoice, settlement or jurisdictional authority.

## 7. Source-feasibility acceptance gate

Accepting this matrix means agreeing that:

1. the exact source portfolio is sufficient to begin a Kill Bill-specific Semantic Model;
2. docs without a matching release tag require code/API/test concurrence for exact-version statements;
3. core code, maintainer tests and the test plugin are one ecosystem, not independent industry consensus;
4. external-key behavior will be modeled as qualified behavior, never universal identity or exactly-once;
5. the refund test-plugin gap blocks a hard runtime oracle but does not block static domain modeling;
6. R1 remains preliminary until a later immutable observation run;
7. current granularity disposition is `KEEP`, with the listed re-evaluation triggers;
8. the next artifact is the Semantic Model only, followed by separate operator confirmation before any
   Behavioral Model or Claim Ledger.

If any item is rejected, narrow or amend the Scope/Matrix before semantic modeling.
