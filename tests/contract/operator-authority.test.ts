import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson, canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  ConfirmationLedgerError,
  OwnerConfirmationLedger,
} from "../../src/domain/confirmation-ledger.js";
import { parseDomainEvidenceCard } from "../../src/domain/contracts.js";
import {
  OperatorAuthorityError,
  recordOperatorAuthority,
} from "../../src/domain/operator-authority.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import {
  validContractConfirmation,
  validDecisionQuestion,
  validEvidenceCard,
  validProductDomainContract,
  validProductDomainContractCandidate,
  validRequirementChangeSet,
} from "../helpers/phase3a-fixtures.js";

test("operator authority writes a protected receipt and the next immutable Card revision", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-project-`);
  const ledgerRoot = await mkdtemp(`${parent}/authority-ledger-`);
  const ledger = new OwnerConfirmationLedger(ledgerRoot);
  const packRoot = `${project}/domain-eval`;
  const candidateRef = "candidates/card-refund-cash-limit.json";
  await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
  const candidate = structuredClone(validEvidenceCard) as Record<string, unknown>;
  candidate.status = "proposed";
  delete candidate.confirmation;
  await writeFile(`${packRoot}/${candidateRef}`, `${canonicalJson(candidate)}\n`, { mode: 0o600 });

  try {
    const result = await recordOperatorAuthority({
      projectRoot: project,
      packPath: "domain-eval",
      candidatePath: candidateRef,
      targetKind: "evidence_card",
      actorId: "domain-owner-commerce",
      occurredAt: "2026-08-19T03:00:00.000Z",
      ledger,
    });
    assert.equal(result.event.origin.kind, "management_cli_operator_invocation");
    assert.equal(result.status, "complete");
    assert.equal(result.artifact?.ref, "evidence-cards/card-refund-cash-limit/r2.json");
    const issued = parseDomainEvidenceCard(
      JSON.parse(await readFile(`${packRoot}/${result.artifact?.ref}`, "utf8")),
    );
    assert.equal(issued.revision, 2);
    assert.equal(issued.status, "confirmed");
    assert.deepEqual(issued.confirmation, result.confirmation);
    assert.deepEqual(await ledger.read(result.confirmation), result.event);

    await recordOperatorAuthority({
      projectRoot: project,
      packPath: "domain-eval",
      candidatePath: candidateRef,
      targetKind: "evidence_card",
      actorId: "domain-owner-commerce",
      occurredAt: "2026-08-19T03:00:00.000Z",
      ledger,
    });
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  }
});

test("a workspace-forged CLI-origin receipt is rejected when absent from the protected ledger", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const ledgerRoot = await mkdtemp(`${parent}/authority-ledger-empty-`);
  const ledger = new OwnerConfirmationLedger(ledgerRoot);
  try {
    await assert.rejects(
      ledger.read({ confirmation_id: "forged-confirmation", sha256: "a".repeat(64) }),
      (error: unknown) =>
        error instanceof ConfirmationLedgerError ||
        (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  } finally {
    await rm(ledgerRoot, { recursive: true, force: true });
  }
});

test("authority preflight rejects unbacked Contract Claims and blocking Requirement questions", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-closure-project-`);
  const ledgerRoot = await mkdtemp(`${parent}/authority-closure-ledger-`);
  const ledger = new OwnerConfirmationLedger(ledgerRoot);
  const packRoot = `${project}/domain-eval`;
  await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
  try {
    const contractCandidateRef = "candidates/unbacked-contract.json";
    await writeFile(
      `${packRoot}/${contractCandidateRef}`,
      `${canonicalJson(validProductDomainContractCandidate)}\n`,
      { mode: 0o600 },
    );
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: contractCandidateRef,
        targetKind: "product_domain_contract",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:10:00.000Z",
        ledger,
      }),
    );
    assert.deepEqual(await readdir(ledgerRoot), []);

    await ledger.write(validContractConfirmation);
    const contractRef = "contracts/synthetic-commerce-contract/v1.json";
    const questionRef = "decision-questions/blocking/r1.json";
    await mkdir(`${packRoot}/contracts/synthetic-commerce-contract`, {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(`${packRoot}/decision-questions/blocking`, { recursive: true, mode: 0o700 });
    await writeFile(
      `${packRoot}/${contractRef}`,
      `${canonicalJson(validProductDomainContract)}\n`,
      {
        mode: 0o600,
      },
    );
    const blockingQuestion = { ...validDecisionQuestion, blocking: true } as const;
    await writeFile(`${packRoot}/${questionRef}`, `${canonicalJson(blockingQuestion)}\n`, {
      mode: 0o600,
    });
    const { confirmation: _confirmation, ...requirementBase } = validRequirementChangeSet;
    const requirementCandidate = {
      ...requirementBase,
      status: "draft",
      decision_question_refs: [{ ref: questionRef, sha256: canonicalJsonDigest(blockingQuestion) }],
    };
    const requirementCandidateRef = "candidates/blocking-requirement.json";
    await writeFile(
      `${packRoot}/${requirementCandidateRef}`,
      `${canonicalJson(requirementCandidate)}\n`,
      { mode: 0o600 },
    );
    const before = await readdir(ledgerRoot);
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: requirementCandidateRef,
        targetKind: "requirement_change_set",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:11:00.000Z",
        ledger,
      }),
    );
    assert.deepEqual(await readdir(ledgerRoot), before);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  }
});

test("post-ledger write failure returns typed incomplete and a later gesture can retry", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-incomplete-project-`);
  const ledgerRoot = await mkdtemp(`${parent}/authority-incomplete-ledger-`);
  const packRoot = `${project}/domain-eval`;
  const candidateRef = "candidates/card-incomplete.json";
  const outputPath = `${packRoot}/evidence-cards/card-refund-cash-limit/r2.json`;
  await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
  const candidate = structuredClone(validEvidenceCard) as Record<string, unknown>;
  candidate.status = "proposed";
  delete candidate.confirmation;
  await writeFile(`${packRoot}/${candidateRef}`, `${canonicalJson(candidate)}\n`, { mode: 0o600 });

  class SabotagingLedger extends OwnerConfirmationLedger {
    override async write(value: unknown) {
      const pointer = await super.write(value);
      await mkdir(outputPath, { recursive: true, mode: 0o700 });
      return pointer;
    }
  }

  try {
    const incomplete = await recordOperatorAuthority({
      projectRoot: project,
      packPath: "domain-eval",
      candidatePath: candidateRef,
      targetKind: "evidence_card",
      actorId: "domain-owner-commerce",
      occurredAt: "2026-08-19T04:20:00.000Z",
      ledger: new SabotagingLedger(ledgerRoot),
    });
    assert.equal(incomplete.status, "incomplete");
    assert.equal(incomplete.error?.code, "AUTHORITY_FINAL_WRITE_INCOMPLETE");

    await rm(outputPath, { recursive: true, force: true });
    const retried = await recordOperatorAuthority({
      projectRoot: project,
      packPath: "domain-eval",
      candidatePath: candidateRef,
      targetKind: "evidence_card",
      actorId: "domain-owner-commerce",
      occurredAt: "2026-08-19T04:21:00.000Z",
      ledger: new OwnerConfirmationLedger(ledgerRoot),
    });
    assert.equal(retried.status, "complete");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  }
});

test("already-confirmed and nested candidates fail before any permanent ledger write", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-preflight-project-`);
  const ledgerRoot = await mkdtemp(`${parent}/authority-preflight-ledger-`);
  const packRoot = `${project}/domain-eval`;
  const candidateRef = "candidates/card.json";
  await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
  const candidate = structuredClone(validEvidenceCard) as Record<string, unknown>;
  await writeFile(`${packRoot}/${candidateRef}`, `${canonicalJson(candidate)}\n`, { mode: 0o600 });
  try {
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: candidateRef,
        targetKind: "evidence_card",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:00:00.000Z",
        ledger: new OwnerConfirmationLedger(ledgerRoot),
      }),
      (error: unknown) =>
        error instanceof OperatorAuthorityError && error.code === "AUTHORITY_TRANSITION_INVALID",
    );
    assert.deepEqual(await readdir(ledgerRoot), []);

    const nestedRef = "candidates/nested/card.json";
    await mkdir(`${packRoot}/candidates/nested`, { recursive: true, mode: 0o700 });
    await writeFile(`${packRoot}/${nestedRef}`, `${canonicalJson(candidate)}\n`, { mode: 0o600 });
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: nestedRef,
        targetKind: "evidence_card",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:01:00.000Z",
        ledger: new OwnerConfirmationLedger(ledgerRoot),
      }),
      /immutable candidates\/<id>\.json namespace/,
    );
    assert.deepEqual(await readdir(ledgerRoot), []);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  }
});
