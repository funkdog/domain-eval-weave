# Phase 4B independent Capsule contribution

You are testing whether DSH Eval Lab can be used without repository source reading or oral help.

## Rules

- Do not read the DSH Eval Lab repository source or tests.
- You may read this kit, CLI help, installed package documentation, public JSON Schemas and the installed
  Commerce reference Capsule.
- Do not ask the project author how to structure or fix the Capsule. Record every blocker in the receipt.
- Do not use production or private data.
- The participant and observer must be different people.

## Goal

Create a new Capsule named `returns-cleanroom` for domain `commerce.returns`, owned by
`returns-owner`, using the three synthetic sources and five anonymous Candidate programs in this kit.

The final Capsule must:

1. trace Claims to the supplied sources;
2. include at least three owner-confirmed Claims and at least one explicit conflict or observability gap;
3. define one Requirement for an eligible customer return;
4. classify and use the Candidate pool as Gold, equivalent and targeted mutants;
5. create and calibrate an initial Evaluator;
6. repair at least one discovered false reject or false accept in a new Evaluator version;
7. compare the two versions;
8. reach `publishable` in `doctor`;
9. persist one accepted Candidate Run and replay it artifact-only.

Candidate programs emit one JSON observation. You may execute them directly to understand their observable
behavior. Their directory names carry no label.

## Start

Install the tarball from the materialized kit:

```sh
mkdir workspace
cd workspace
pnpm init
pnpm add ../package/dsh-eval-lab-*.tgz

dsh-eval-capsule init \
  ./returns-cleanroom returns-cleanroom commerce.returns returns-owner

dsh-eval-capsule doctor ./returns-cleanroom
dsh-eval-capsule show ./returns-cleanroom
```

Use `FILE_SHAPES.md`, the installed public Schemas, and the installed Commerce reference only as format
guidance. Copy the source and Candidate files into your Capsule using paths you can explain.

After completion, the observer fills `receipt-template.json`. The project maintainer runs:

```sh
node scripts/verify-phase4b-cleanroom.mjs \
  <materialized-kit> <submission-capsule> <receipt.json>
```

A passing verifier is necessary but not sufficient to change release status; the receipt remains subject to
maintainer review.
