---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, capsule, contracts, compatibility]
doc_kind: architecture
created: 2026-08-26
description: "Phase 4A contract classification: public core, internal runtime, optional research and legacy replay."
---

# Phase 4A Contract Classification

Phase 4A stops treating every persisted proof object as a public authoring contract. Classification governs documentation and exports;
it does not delete historical replay assets.

## Public core

Only `contracts/capsule/` is part of the Phase 4A contributor surface:

- `capsule-manifest`;
- `domain-contract`;
- `requirement-delta`;
- `evaluator-package`;
- `calibration-case`;
- `evaluation-run`.

The generated Capsule release lock and Harness projection are tool output, not contributor-authored inputs.

## Internal runtime

These concepts remain implementation details unless projected through the six public faces:

- artifact refs, canonical JSON, digests and release locks;
- process descriptors and receipts;
- DSH profile, deployment fingerprint, bridge and auth state;
- Candidate freeze, Session discovery and runtime lineage;
- derived dependency graphs, readiness reports, authority maps and normal forms;
- activation and cost event normalization.

## Optional research

The following assets remain available for evaluator research but cannot block Capsule v0 Delivery:

- Phase 3A author-forward qualification cohorts;
- Phase 3C Semantic and Code Quality Judge contracts;
- Judge development, locked holdout, bias, freeze, unseal and admission artifacts;
- external TDD Skill qualification and task registry;
- four-axis research reports.

## Legacy replay

The following schema families remain immutable compatibility inputs:

- root Phase 1/2 Experiment, Episode, Suite, Registry, Exposure, Qualification and Report schemas;
- Phase 3A/B generic domain and delivery artifacts;
- `contracts/commerce/`;
- `contracts/commerce-withdrawal/`;
- historical Phase 3C Campaign artifacts.

New domains cannot copy one of these template stacks. They contribute Capsule data, evaluator checks, calibration cases and observation adapters.

## Export rule

`dsh-eval-lab/capsule` exports only the six public schemas plus contributor operations. Runtime and research modules use separate package exports.
No public-core module may import DSH Session packages, auth, runtime profiles, Phase 3C Judge code or a domain production template.
