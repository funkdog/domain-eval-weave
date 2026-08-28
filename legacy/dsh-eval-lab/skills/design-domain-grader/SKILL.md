---
name: design-domain-grader
description: Turn product-domain evidence and owner knowledge into provenance-bound Evidence Cards, a versioned Product Domain Contract, Requirement ChangeSets, and an impact graph. Use for domain onboarding, designing a domain grader, extracting business invariants, binding a new requirement to shared domain truth, auditing stale/conflicting truth, or explicit onboard/delta/audit requests. Do not use to invent product policy, generate grader runtime, judge a Candidate, or promote requirement changes automatically.
---

# Design Domain Grader

Build the authoring inputs that a later deterministic grader can trust. Keep industry knowledge, product truth, requirement change, and executable evaluation separate.

## Start by choosing one mode

- Use `onboard` when no validated Product Domain Contract exists.
- Use `delta` when a new requirement must bind to a validated Contract.
- Use `audit` when checking source freshness, conflicts, observability, or reverse impact.

State the selected mode and why. For `delta` or `audit`, validate and read the current Contract, Requirement ChangeSets, and impact graph before asking questions. Stop if their exact bytes or pointers do not validate.

## Establish the evidence boundary

1. Confirm the authorized project root and use `<project>/domain-eval` unless the user selected another in-project path.
2. Read only user-authorized product documents, requirements, code, tests, external contracts, and synthetic/runtime observations.
3. Never read credentials, ambient agent homes, production data, hidden Candidate Oracle assets, or unrelated runtime state.
4. Call `domain_artifact` with `action=snapshot_source` for every cited source. Pass a project-relative `source_path` for a file, or `content`
   only for the explicit owner statement just received. Use the returned SourceRef verbatim; never calculate, copy, or invent a digest.
5. Treat Domain Knowledge Packs and model knowledge as question generators only. They cannot be authority refs.

Before writing artifacts, read [references/artifact-contracts.md](references/artifact-contracts.md). When conducting an interview, also read [references/interview-protocol.md](references/interview-protocol.md). Load [references/failure-modes.md](references/failure-modes.md) before issuing readiness.

## Use the deterministic artifact helper

Build values with the exact snake_case fields shown in the package schemas/templates, then call `domain_artifact` with
`action=write_artifact`. Use only SourceRefs and artifact pointers returned by earlier successful helper calls. Do not use the editor to write
`sources/`, `candidates/`, or primary artifact namespaces, and do not substitute camelCase envelopes, `identity-utf8`, placeholder hashes, or
non-canonical JSON when the helper returns diagnostics. Correct the reported field/path and retry; a failed call writes nothing.

Persist a non-confirmed Evidence Card or open DecisionQuestion at its canonical revision path first. Only when the operator intends to confirm
that object, call `stage_confirmation_candidate` with the returned primary pointer and a single-level `candidates/<candidate-id>.json` ref.
Product Domain Contract and Requirement ChangeSet drafts go directly through `write_artifact` using their candidate kinds. The helper never
grants authority; continue to use management `domain confirm` for every protected transition.

## Interview adaptively

Start from one concrete successful case and one rejected or failed case. Add only the counterfactuals that can change the current Claim set: duplicate/conflicting requests, concurrency, reordering, delay, partial failure, restart, compensation, identity alignment, authority, and time windows.

Ask at most three tightly related questions per turn. Prefer a concrete scenario over abstract terminology. Explain which Claim or decision each question unblocks.

After every answer, replay this projection:

```text
confirmed
proposed
unresolved
conflicted
observability_gap
```

Persist the question, reason, source refs, answer ref, affected Claim IDs, and status. Do not wait until the end to manufacture a transcript.

## Classify before promotion

- Mark `confirmed` only when an explicit Domain Owner confirmation is captured as a digest-bound OwnerConfirmationEvent and at least one non-knowledge authority source is bound.
- Mark `proposed` when evidence suggests a rule but the owner has not signed it.
- Mark `unresolved` when a product policy or authority choice is missing.
- Mark `conflicted` when two sources disagree; retain both source refs.
- Mark `observability_gap` when truth may be known but no reliable observation can adjudicate it.

Never silently upgrade a state. Never interpret agreement to continue the interview as confirmation of a Claim or Contract. Actor strings written by the Skill are not authority evidence.

## Produce the smallest decision packet

Read discoverable evidence before asking the owner. Surface only questions that require product policy, risk tolerance, authority selection, or conflict resolution. For each question include:

- why it cannot be derived;
- the blocked Claim IDs;
- false-accept and false-reject risk;
- the concrete options or missing evidence;
- what later Grader capability remains blocked.

If blocking questions remain, emit draft artifacts and report readiness as `red`; do not sign or compile anything. Do not persist a
`DomainTruthReadinessReport` or `DomainPackManifest` until an issued Contract and at least one Requirement form a schema-valid closure.

## Mode-specific completion

### Onboard

Use the helper to snapshot evidence, write immutable InterviewSession/Evidence Card/DecisionQuestion primary revisions, and stage only selected
Card/Question pointers as confirmation candidates. Ask the operator to run the management `domain confirm` command; never write or imitate
OwnerConfirmationEvents. After the protected ledger receipt validates, use the management-produced Evidence Card revision and write a new
InterviewSession revision that references it. Promote only selected confirmed Cards into Product Domain Contract version 1. Leave every other
Card outside the Contract.

### Delta

Pin the exact versioned base Contract. Use its impact graph to scope affected Claims; do not re-ask unrelated confirmed truth. Create one
Requirement ChangeSet with the helper's candidate kind at a single-level `candidates/<candidate-id>.json` path using only `uses`, `preserves`, `introduces`, `modifies`,
`deprecates`, and `conflicts_with`. Persist unresolved choices as revisioned DecisionQuestion artifacts and ask the operator to confirm the final
Requirement through the protected management surface. Before confirmation, compute graph/readiness previews only for the report; do not persist
candidate graph, readiness, or manifest objects in ad hoc namespaces. Requirement-scoped proposals never mutate the base Contract.

### Audit

Recheck source bindings, confirmation, conflicts, observations, Claim dependencies, Requirement edges, and reverse impact. If the exact
manifest validates, produce findings and a new readiness artifact. If source bytes, pointers, or protected receipts fail validation, stop,
preserve the historical artifacts, and report the failed dimension/reason without manufacturing a readiness artifact. Do not rewrite primary
artifacts unless the user explicitly authorizes a new version.

## Validate and report

Once a complete issued closure exists, run the repository-provided deterministic validator and impact query against an exact immutable
DomainPackManifest, and persist a DomainReadinessRequest that points to exact Requirement versions. Before that boundary, validate each
candidate with its schema and exact refs and report why full-pack validation is deferred. Treat schema, protected-ledger confirmation, digest,
path, graph, lifecycle, or replay failure as `red`; a validator failure is a reportable result, not permission to create a substitute manifest or
readiness object. Treat unresolved/conflicted/observability gaps according to whether they intersect the derived requested closure. Never average
hard failures into a score.

Report:

```text
mode and evidence snapshot
confirmed/proposed/unresolved/conflicted/observability_gap counts with IDs
Contract version and digest, if issued
Requirement effects and impacted Claim closure, if present
decision packet
readiness dimensions and exact reasons
next permitted action
```

`green` means only `domain_truth_ready`. It does not mean grader admitted, requirement delivered, Candidate accepted, or Harness effective.
