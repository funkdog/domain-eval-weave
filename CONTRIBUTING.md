# Contributing to DSH Eval Lab

DSH Eval Lab accepts engine changes and provenance-bound Capsule assets. Use only synthetic, licensed or
explicitly authorized source material. Never commit production user data, credentials, OAuth material,
runtime Sessions or generated `.eval/` state.

## Capsule contributions

1. Initialize a truth-empty draft with `dsh-eval-capsule init`.
2. Add sources with descriptions and licenses.
3. Add Claims as `proposed`, `unresolved`, `conflicted` or `observability_gap` until an authorized owner
   explicitly confirms them.
4. Bind Requirements to existing Claims; required hard Claims must be confirmed.
5. Add Gold, behaviorally equivalent and targeted mutant Candidates.
6. Calibrate the exact Evaluator version and inspect per-Claim deltas.
7. Run `doctor`, `show`, `validate`, `calibrate`, `compare` and replay before opening a pull request.

Contributors never author digests, release locks, receipts or Run ids. Do not copy a historical Commerce or
Withdrawal production stack for a new domain.

## Engine changes

Run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm readiness:open-source
```

Bug fixes require a reproducing test before the implementation change. Evaluator changes must identify the
affected Claim, false-accept/false-reject risk and calibration case. One pair or one Judge run never supports
a general uplift claim.

## Reviews

Authors cannot approve their own code. Capsule review checks provenance and domain authority separately from
Evaluator calibration and runtime safety. A passing schema is necessary but does not make a Claim true.
