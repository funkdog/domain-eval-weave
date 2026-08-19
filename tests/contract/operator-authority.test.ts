import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../src/contracts/canonical-json.js";
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
import { writeSyntheticDomainPack } from "../helpers/domain-pack-fixture.js";
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
  const policyBytes = "Cash refunds never exceed captured cash payment.\n";
  candidate.source_refs = [
    {
      source_id: "refund-policy-doc",
      kind: "product_doc",
      artifact_ref: "sources/refund-policy.md",
      digest: sha256Hex(policyBytes),
    },
  ];
  candidate.authority_ref_ids = ["refund-policy-doc"];
  candidate.observation_ref_ids = [];
  await mkdir(`${packRoot}/sources`, { recursive: true, mode: 0o700 });
  await writeFile(`${packRoot}/sources/refund-policy.md`, policyBytes, { mode: 0o600 });
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

test("authority preflight verifies Card sources before persisting confirmation", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-card-source-project-`);
  const ledgerRoot = await mkdtemp(`${parent}/authority-card-source-ledger-`);
  const packRoot = `${project}/domain-eval`;
  const candidateRef = "candidates/card-missing-source.json";
  await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
  const { confirmation: _confirmation, ...cardBase } = validEvidenceCard;
  const candidate = {
    ...cardBase,
    status: "proposed",
    source_refs: [
      {
        ...validEvidenceCard.source_refs[0],
        artifact_ref: "sources/does-not-exist.md",
      },
    ],
    authority_ref_ids: [validEvidenceCard.source_refs[0].source_id],
    observation_ref_ids: [],
  } as const;
  await writeFile(`${packRoot}/${candidateRef}`, `${canonicalJson(candidate)}\n`, { mode: 0o600 });
  try {
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: candidateRef,
        targetKind: "evidence_card",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:12:00.000Z",
        ledger: new OwnerConfirmationLedger(ledgerRoot),
      }),
    );
    assert.deepEqual(await readdir(ledgerRoot), []);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  }
});

test("authority preflight closes Contract source snapshots and Requirement sources", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-source-closure-project-`);
  try {
    const { packRoot, confirmationLedger } = await writeSyntheticDomainPack(project);
    const contract = JSON.parse(
      await readFile(`${packRoot}/contracts/synthetic-commerce-contract/v1.json`, "utf8"),
    ) as Record<string, unknown>;
    const {
      state: _state,
      confirmation: _confirmation,
      decided_by: _by,
      decided_at: _at,
      ...contractDraft
    } = contract;
    contractDraft.contract_id = "unbound-source-contract";
    contractDraft.source_snapshot_digest = "f".repeat(64);
    const contractCandidateRef = "candidates/unbound-source-contract.json";
    await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
    await writeFile(`${packRoot}/${contractCandidateRef}`, `${canonicalJson(contractDraft)}\n`, {
      mode: 0o600,
    });
    const ledgerRoot = `${project}/test-runtime/domain-confirmations`;
    const beforeContract = await readdir(ledgerRoot);
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: contractCandidateRef,
        targetKind: "product_domain_contract",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:16:00.000Z",
        ledger: confirmationLedger,
      }),
    );
    assert.deepEqual(await readdir(ledgerRoot), beforeContract);

    const requirement = JSON.parse(
      await readFile(`${packRoot}/requirements/order-cancellation-v1/v1.json`, "utf8"),
    ) as Record<string, unknown>;
    delete requirement.confirmation;
    requirement.requirement_id = "missing-source-requirement";
    requirement.status = "draft";
    requirement.requirement_refs = [
      {
        ...((requirement.requirement_refs as Array<Record<string, unknown>>)[0] ?? {}),
        artifact_ref: "sources/missing.md",
      },
    ];
    const requirementCandidateRef = "candidates/missing-source-requirement.json";
    await writeFile(`${packRoot}/${requirementCandidateRef}`, `${canonicalJson(requirement)}\n`, {
      mode: 0o600,
    });
    const beforeRequirement = await readdir(ledgerRoot);
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: requirementCandidateRef,
        targetKind: "requirement_change_set",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:17:00.000Z",
        ledger: confirmationLedger,
      }),
    );
    assert.deepEqual(await readdir(ledgerRoot), beforeRequirement);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("authority preflight rejects cross-product/risk Contract drift and forged question resolution", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-identity-project-`);
  try {
    const { packRoot, confirmationLedger } = await writeSyntheticDomainPack(project);
    const contract = JSON.parse(
      await readFile(`${packRoot}/contracts/synthetic-commerce-contract/v1.json`, "utf8"),
    ) as Record<string, unknown>;
    const {
      state: _state,
      confirmation: _confirmation,
      decided_by: _by,
      decided_at: _at,
      ...draft
    } = contract;
    const claims = (draft.claims as Array<Record<string, unknown>>).map((claim) => ({
      ...claim,
      false_accept_risk: "low",
      false_reject_risk: "low",
    }));
    const contractCandidate = {
      ...draft,
      contract_id: "cross-product-contract",
      product_id: "other-product",
      claims,
    };
    const contractCandidateRef = "candidates/cross-product-contract.json";
    await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
    await writeFile(
      `${packRoot}/${contractCandidateRef}`,
      `${canonicalJson(contractCandidate)}\n`,
      { mode: 0o600 },
    );
    const beforeContract = await readdir(`${project}/test-runtime/domain-confirmations`);
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: contractCandidateRef,
        targetKind: "product_domain_contract",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:13:00.000Z",
        ledger: confirmationLedger,
      }),
    );
    assert.deepEqual(await readdir(`${project}/test-runtime/domain-confirmations`), beforeContract);

    const forgedQuestion = {
      ...validDecisionQuestion,
      product_id: "other-product",
      requirement_id: "other-requirement",
      blocking: true,
      status: "resolved",
      resolution_confirmation: {
        confirmation_id: "missing-question-confirmation",
        sha256: "a".repeat(64),
      },
    } as const;
    const questionRef = "decision-questions/forged/r1.json";
    await mkdir(`${packRoot}/decision-questions/forged`, { recursive: true, mode: 0o700 });
    await writeFile(`${packRoot}/${questionRef}`, `${canonicalJson(forgedQuestion)}\n`, {
      mode: 0o600,
    });
    const requirement = JSON.parse(
      await readFile(`${packRoot}/requirements/order-cancellation-v1/v1.json`, "utf8"),
    ) as Record<string, unknown>;
    delete requirement.confirmation;
    requirement.requirement_id = "forged-question-requirement";
    requirement.status = "draft";
    requirement.decision_question_refs = [
      { ref: questionRef, sha256: canonicalJsonDigest(forgedQuestion) },
    ];
    const requirementCandidateRef = "candidates/forged-question-requirement.json";
    await writeFile(`${packRoot}/${requirementCandidateRef}`, `${canonicalJson(requirement)}\n`, {
      mode: 0o600,
    });
    const beforeQuestion = await readdir(`${project}/test-runtime/domain-confirmations`);
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: requirementCandidateRef,
        targetKind: "requirement_change_set",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:14:00.000Z",
        ledger: confirmationLedger,
      }),
    );
    assert.deepEqual(await readdir(`${project}/test-runtime/domain-confirmations`), beforeQuestion);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("symlinked authority output parents fail before ledger mutation", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-symlink-project-`);
  const outside = await mkdtemp(`${parent}/authority-symlink-outside-`);
  const ledgerRoot = await mkdtemp(`${parent}/authority-symlink-ledger-`);
  const packRoot = `${project}/domain-eval`;
  const candidateRef = "candidates/card-symlink-output.json";
  await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
  const { confirmation: _confirmation, ...cardBase } = validEvidenceCard;
  const candidate = { ...cardBase, status: "proposed" } as const;
  await writeFile(`${packRoot}/${candidateRef}`, `${canonicalJson(candidate)}\n`, { mode: 0o600 });
  await symlink(outside, `${packRoot}/evidence-cards`);
  try {
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: candidateRef,
        targetKind: "evidence_card",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T04:15:00.000Z",
        ledger: new OwnerConfirmationLedger(ledgerRoot),
      }),
    );
    assert.deepEqual(await readdir(ledgerRoot), []);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
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
  const policyBytes = "Cash refunds never exceed captured cash payment.\n";
  candidate.source_refs = [
    {
      source_id: "refund-policy-doc",
      kind: "product_doc",
      artifact_ref: "sources/refund-policy.md",
      digest: sha256Hex(policyBytes),
    },
  ];
  candidate.authority_ref_ids = ["refund-policy-doc"];
  candidate.observation_ref_ids = [];
  await mkdir(`${packRoot}/sources`, { recursive: true, mode: 0o700 });
  await writeFile(`${packRoot}/sources/refund-policy.md`, policyBytes, { mode: 0o600 });
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
