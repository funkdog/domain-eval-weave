# Artifact contracts

## Contents

1. Pack layout
2. Primary objects
3. Source and pointer rules
4. Lifecycle boundaries
5. Validation order

## 1. Pack layout

```text
domain-eval/
├── sources/<immutable-source-snapshot>
├── candidates/<candidate-id>.json
├── interviews/<interview-id>/r<revision>.json
├── evidence-cards/<card-id>/r<revision>.json
├── decision-questions/<question-id>/r<revision>.json
├── contracts/<contract-id>/v<version>.json
├── requirements/<requirement-id>/v<version>.json
├── graphs/<graph-id>.json
├── readiness/requests/<request-id>.json
├── readiness/reports/<report-id>.json
└── manifests/<snapshot-id>.json
```

Use canonical JSON. Keep every reference relative to the pack root, normalized, and free of `..`, absolute paths, backslashes, empty segments,
symlinks, and special filesystem entries. Authority candidates are single files directly under `candidates/`; nested candidate directories and
candidate graph/readiness/manifest files are not contract surfaces.

## 2. Primary objects

- InterviewSession preserves questions, reasons, answers, source snapshot, decision packet, mode, and terminal status.
- EvidenceCard is the only object with the five evidence states.
- OwnerConfirmationEvent lives only in the management-owned runtime ledger. Source artifacts carry an id+digest receipt; actor strings or workspace JSON are not evidence.
- DecisionQuestion persists blocking scope and explicit resolution evidence.
- ProductDomainContract contains only promoted confirmed Claims, binds the exact completed source Interview, and has an explicit
  version/predecessor chain.
- RequirementChangeSet pins one exact base Contract and expresses six typed effects.
- ClaimDependencyGraph is derived from Contract + RequirementChangeSets.
- DomainTruthReadinessReport is derived and rule-based; it is not a score.
- ProductDomainContract candidates use their dedicated candidate schema; Card, Requirement, and DecisionQuestion candidates reuse their
  primary schemas.

Use the package JSON Schemas under `contracts/` as the field-level truth. Do not improvise extra fields.

## 3. Source and pointer rules

Every SourceRef includes `source_id`, `kind`, `artifact_ref`, `digest`, and an optional portable locator. Without a locator, the digest binds the whole source artifact. A JSON-pointer locator binds the canonical JSON value at that pointer; use this for an owner answer stored inside its InterviewSession so the artifact does not hash itself. Other locators identify an anchor/symbol while the digest continues to bind the whole file. Domain knowledge cannot be the only authority for a confirmed Claim.

Every DomainArtifactPointer includes the exact pack-root-relative ref and SHA-256 of canonical bytes. OwnerConfirmationPointer instead contains
`confirmation_id + sha256` and must resolve through the repository validator in the protected runtime ledger; never inspect or imitate that
ledger directly. Recompute and compare before using a referenced object. Authority inputs use immutable canonical
`candidates/<candidate-id>.json` paths. Phase 3A persists authority events only for successful confirmation; an unconfirmed candidate remains in
the authoring plane and may be revised without creating reject/withdraw governance history.

## 4. Lifecycle boundaries

- Every interview/card/question transition writes a new revision; every Contract/Requirement transition writes a new version. Never overwrite an existing path.
- Contract versions preserve stable Claim IDs and explicit supersede/retire predecessors; the successor Contract confirmation authorizes the
  complete version rather than creating per-Claim governance events.
- Unmentioned existing Claims remain present during promotion; no silent deletion.
- Requirement `introduces/modifies/deprecates` remain proposals until a later explicit Contract issuance.
- A passing requirement evaluation never updates ProductDomainContract.
- No artifact has automatic TTL or cleanup.

## 5. Validation order

1. path containment and entry type;
2. JSON parse + schema;
3. semantic state constraints;
4. ref/digest and OwnerConfirmationEvent target-projection closure;
5. Contract/Requirement identity, version, Claim transition, and DecisionQuestion binding;
6. graph endpoints, transition edges, unique edges, dependency cycles, reverse index replay;
7. ReadinessRequest requested-closure recomputation.

Fail closed at the first invalid layer and preserve the invalid bytes for diagnosis. A failed layer means “report red and stop”; it does not
authorize a synthetic red readiness artifact. Persist readiness/manifest artifacts only when the full issued Contract + Requirement closure is
schema-valid and replayable.
