---
feature_ids: []
topics: [public-domain-landscape, software-supply-chain, identity, ecommerce, evidence]
doc_kind: research-evidence
created: 2026-09-01
status: preliminary
---

# Preliminary Primary-Source Evidence

This is a bounded first-pass source audit for selecting the first authoritative public Domain Landscape.
It is not the final multi-provider deep-research report.

## Software supply-chain security

| Source | Authority and useful scope | Initial disposition |
|---|---|---|
| [SLSA v1.2 specification](https://slsa.dev/spec/v1.2/) | Approved industry specification for source/build tracks, levels, provenance and verification | Strong Domain Module and Claim source |
| [SLSA specification repository](https://github.com/slsa-framework/slsa) | Versioned source of released and draft SLSA specifications | Snapshot/version audit required |
| [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) | U.S. government secure-development practices and acquisition vocabulary | Government-guidance authority only |
| [NIST software supply-chain guidance](https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/software-supply-chain-security-guidance-14) | Official producer/consumer, attestation, verification and SBOM guidance | Useful normative/role Claims |
| [EU Cyber Resilience Act 2024/2847](https://eur-lex.europa.eu/eli/reg/2024/2847/oj) | EU legal obligations for products with digital elements | Jurisdiction-scoped legal Claims; requires legal review |
| [CycloneDX specification overview](https://cyclonedx.org/specification/overview/) | Machine-readable BOM object model spanning components, services, dependencies, vulnerabilities, formulation, declarations and citations | Strong competing representation; redistribution/license audit pending |
| [in-toto](https://in-toto.io/) | CNCF graduated open metadata standard and Apache-licensed tooling for supply-chain step integrity | Strong attestation/step model |
| [in-toto Attestation Framework](https://github.com/in-toto/attestation) | Maintained attestation statement/predicate model with language bindings | Strong formal artifact source |
| [Sigstore architecture documents](https://github.com/sigstore/architecture-docs) | Formal client, Fulcio, Rekor and public deployment specifications | Strong signing/transparency context |
| [Cosign](https://github.com/sigstore/cosign) | Real OSS implementation for signing/verifying OCI and other artifacts, including in-toto attestations | Implementation-specific representation |
| [Sigstore conformance](https://github.com/sigstore/sigstore-conformance) | Apache-2.0 end-to-end client conformance suite with daily multi-client reports and invalid-proof/signature fixtures | Strong baseline Bench seed |
| [Rekor Tiles](https://github.com/sigstore/rekor-tiles) | Real evolving transparency-log implementation with E2E tests and storage variants | Evolution/competing implementation source |

Preliminary strength:

- distinct issuing authorities: NIST, EU legislature, SLSA/OpenSSF community, OWASP/Ecma,
  CNCF/in-toto and Sigstore;
- machine-readable artifacts and exact verification semantics;
- competing models rather than one vendor's ontology;
- public invalid/valid test assets that can seed Gold/equivalent/mutant cases;
- natural bitemporal and provenance problems;
- observable verification semantics with honest refusal modes.

Primary risks:

- specifications evolve quickly and released/draft status must remain distinct;
- SBOM completeness, vulnerability applicability and "secure" remain epistemically different;
- legal obligations cannot be inferred from SLSA/SBOM conformance;
- license and redistribution rules differ across specifications and fixture assets;
- a conformance suite can become a narrow proxy rather than the domain boundary.

## Internet identity and authorization

| Source | Authority and useful scope | Initial disposition |
|---|---|---|
| [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) | Final identity-layer specification over OAuth 2.0 | Strong protocol Claims |
| [OAuth 2.0 Security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) | IETF Best Current Practice for current OAuth security | Strong security-practice Claims |
| [OpenID Foundation certification](https://openid.net/certification/) | Official certification/conformance program | Bench asset availability/licensing needs audit |
| [WebAuthn standards](https://www.w3.org/TR/webauthn/all/) | W3C authentication API and authenticator model | Strong separate Model Context |
| [Keycloak implemented specifications](https://www.keycloak.org/securing-apps/specifications) | Real OSS support/certification matrix, including explicit unsupported/experimental areas | Excellent implementation-divergence evidence |
| [Keycloak OIDC documentation](https://www.keycloak.org/securing-apps/oidc-layers) | Concrete provider endpoints and local representation | Implementation-scoped Claims only |

Preliminary strength:

- mature terminology and protocol state machines;
- strong conformance culture;
- real implementation divergence is explicitly documented;
- abundant negative security cases and exact token/session artifacts.

Primary risks:

- scope can explode across authentication, authorization, federation, provisioning, recovery,
  sessions, credentials, privacy and identity proofing;
- protocol conformance is not equivalent to secure product behavior;
- certification assets may be hosted or access-restricted;
- safe executable integration often requires network/browser/cryptographic environment setup;
- high security stakes increase reviewer and authority costs.

## Payment lifecycle and funds closure

| Source | Authority and useful scope | Initial disposition |
|---|---|---|
| [Mojaloop documentation](https://docs.mojaloop.io/) | Official docs for an open-source interoperable payments platform | Strong scheme/implementation source |
| [Mojaloop transactions](https://docs.mojaloop.io/product/features/transaction.html) | Asynchronous discovery, quotation, transfer and settlement phases | Strong lifecycle source |
| [Mojaloop specification](https://github.com/mojaloop/mojaloop-specification) | Versioned FSP interoperability and central-ledger APIs | Strong protocol/schema source |
| [Mojaloop organization](https://github.com/mojaloop) | Apache-2.0 open-source implementations and specifications | Redistribution-friendly implementation family |
| [Hyperswitch repository](https://github.com/juspay/hyperswitch) | Apache-2.0 modular payment orchestration, connectors, retries and reconciliation | Strong provider/orchestration representation |
| [Kill Bill repository](https://github.com/killbill/killbill) | Open-source billing and payments platform with separate payment/accounting semantics | Independent implementation candidate |
| [Stripe refunds](https://docs.stripe.com/refunds) | Official vendor behavior for cancellation, partial/full refunds, balance and pending states | Provider-scoped Claims only |
| [Stripe disputes](https://docs.stripe.com/disputes) | Official vendor dispute/chargeback lifecycle | Must remain distinct from refund |
| [EU Payment Services Directive 2015/2366](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32015L2366) | Official EU payment-services obligations | Jurisdiction-scoped legal Claims; legal review required |

Preliminary strength:

- official regulation, open protocol/scheme, real OSS orchestration and provider docs create plural
  non-substitutable Authority scopes;
- asynchronous transfers, provider retries, clearing positions, settlement, refunds, disputes and ledger
  reconciliation create a complete non-trivial lifecycle;
- Apache-2.0 Mojaloop/Hyperswitch assets and machine-readable APIs can support a public fixture and Bench;
- exact amounts, currencies, state transitions, idempotency and economic effects are observable while still
  exposing missing-webhook and incomplete-settlement refusal modes;
- payment terminology is accessible to a broader contributor base than software-supply-chain security.

Primary risks:

- ISO/card-network materials and some provider rules may be non-redistributable or access-restricted;
- regulation is jurisdiction-specific and cannot be reduced to API conformance;
- provider docs can establish only provider behavior, not universal payment truth;
- fraud, KYC/AML, tax and every payment method would make the first scope unbounded;
- open-source implementations may diverge at identity, ledger and settlement boundaries;
- synthetic fixtures may not reproduce all real operational failures.

## Public e-commerce after-sales/value restoration

| Source | Authority and useful scope | Initial disposition |
|---|---|---|
| [Medusa order return](https://docs.medusajs.com/resources/commerce-modules/order/return) | Real OSS RMA, return item, receipt, refund and order-version model | Strong implementation model |
| [Medusa payment management](https://docs.medusajs.com/user-guide/orders/payments) | Real partial/full refund and provider-processing behavior | Implementation-scoped Claims |
| [Saleor documentation](https://docs.saleor.io/) | Real OSS commerce contexts including orders, promotions, channels and payments | Requires deeper model/repo audit |
| [Saleor repository](https://github.com/saleor/saleor) | Open-source implementation and versioned model | Strong second representation |
| [EU consumer rights summary](https://ec.europa.eu/consumers/odr/resources/public2/documents/consumer_rights/EN/five_key_consumer_rights_en.pdf) | Official consumer-facing withdrawal/refund guidance | Legal source discovery must trace to legislation |
| [Stripe refund documentation](https://docs.stripe.com/refunds) | Vendor-specific payment refund behavior | Provider authority only |
| [Stripe dispute documentation](https://docs.stripe.com/disputes) | Vendor-specific dispute/chargeback behavior | Must remain distinct from merchant refund |

Preliminary strength:

- intuitive contributor journey and visible cross-context semantics;
- real state, compensation, partial-value and accounting problems;
- OSS models expose concrete divergence.

Primary risks:

- product policy and jurisdiction dominate many Claims;
- no single public source defines end-to-end value restoration;
- payment provider docs are vendor authority, not universal truth;
- legal interpretation and proprietary promotion/accounting rules increase manual confirmation;
- public Bench assets are weaker and would require more repository-authored synthetic fixtures.

## Initial comparison

| Criterion | Supply chain | Identity | Payments | E-commerce |
|---|---|---|---|---|
| Primary-source authority | Strong, plural | Strong, plural | Strong but scoped | Fragmented |
| OSS representation plurality | Strong | Strong | Strong | Moderate |
| Public executable test assets | Strong | Strong but access/environment concerns | Moderate-to-strong | Weak-to-moderate |
| Offline deterministic Bench potential | Strong | Moderate | Strong with synthetic Episodes | Moderate |
| Regulatory/standard layering | Strong | Strong | Strong | Strong but jurisdiction-heavy |
| Manual owner-confirmation cost | Low-to-moderate | Moderate | Moderate | High |
| Scope containment | Good around artifact trust | Difficult | Good with explicit exclusions | Difficult end-to-end |
| Business-domain richness | Moderate | Strong | Very strong | Very strong |
| Contributor accessibility | High for developers/security | Moderate | High | High conceptually |
| Preliminary choice | Control pilot | Defer | Flagship candidate | Compose after payments |
