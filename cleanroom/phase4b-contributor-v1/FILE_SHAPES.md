# Public file shapes

These are structural examples, not domain answers.

## Claim

```yaml
- claim_id: replace-me
  statement: One falsifiable product statement.
  applicability: The exact scope where it applies.
  status: proposed
  source_ids: [source-id]
  false_accept_risk: high
  false_reject_risk: medium
```

Confirm a proposed Claim only through the CLI:

```sh
domain-eval confirm <capsule> <claim-id> <owner-id>
```

## Requirement edge

```yaml
- claim_id: replace-me
  relation: uses
  required: true
```

Relations are `uses`, `preserves`, `introduces`, `modifies`, `deprecates` and
`conflicts_with`.

## Evaluator checks

```yaml
- check_id: replace-me
  claim_id: replace-me
  kind: json_path_equals
  path: [state, status]
  expected: replace-me
```

```yaml
- check_id: replace-me-count
  claim_id: replace-me
  kind: json_array_count_equals
  path: [effects]
  where: { type: replace-me }
  expected_count: 1
```

## Calibration case

```yaml
schema_version: 1
case_id: replace-me
kind: gold
candidate_id: replace-me
expected_claims:
  - { claim_id: replace-me, status: pass }
```

A mutant additionally declares `target_claim_ids`. Expectations cover every required Claim.
