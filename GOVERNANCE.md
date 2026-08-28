# Governance

DomainEval Weave separates product truth, evaluator quality and release authority.

## Roles

- **Maintainers** own engine contracts, package boundaries, security and releases.
- **Capsule contributors** provide licensed sources, Claims, Requirements, Candidates and calibration cases.
- **Domain owners** may confirm Claims only within their declared authority; engine maintainers cannot replace
  missing domain authority.
- **Evaluator reviewers** examine observation validity, equivalent false rejects and targeted mutant coverage.

One person may hold multiple roles but cannot approve their own implementation. Domain confirmation and code
review are independent decisions.

## Decisions

Public contract changes require a versioned proposal, compatibility analysis and calibration/replay evidence.
New hard verdicts require a confirmed Claim and an observable check. Research Judges remain opt-in and cannot
block deterministic Delivery unless separately admitted.

Historical Phase 1–3C artifacts remain replay-compatible until a published sunset policy says otherwise. New
domains use Capsules rather than copying legacy template stacks.

## Releases

Developer Preview requires an explicit code/data license decision, clean package closures, supported-platform
CI and no unresolved security blocker. Public Alpha additionally requires an independent human clean-room
Capsule contribution. The source repository may be public as a Developer Preview before that human exercise;
npm publication remains a separate release decision. Automated tests cannot self-certify either external gate.
