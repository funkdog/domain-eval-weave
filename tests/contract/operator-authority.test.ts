import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson } from "../../src/contracts/canonical-json.js";
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
import { validEvidenceCard } from "../helpers/phase3a-fixtures.js";

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
      decision: "confirm",
      occurredAt: "2026-08-19T03:00:00.000Z",
      ledger,
    });
    assert.equal(result.event.origin.kind, "management_cli_operator_invocation");
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
      decision: "confirm",
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

test("illegal target/decision combinations fail before any permanent ledger write", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/authority-preflight-project-`);
  const ledgerRoot = await mkdtemp(`${parent}/authority-preflight-ledger-`);
  const packRoot = `${project}/domain-eval`;
  const candidateRef = "candidates/card.json";
  await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
  const candidate = structuredClone(validEvidenceCard) as Record<string, unknown>;
  candidate.status = "proposed";
  delete candidate.confirmation;
  await writeFile(`${packRoot}/${candidateRef}`, `${canonicalJson(candidate)}\n`, { mode: 0o600 });
  try {
    await assert.rejects(
      recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: candidateRef,
        targetKind: "evidence_card",
        actorId: "domain-owner-commerce",
        decision: "withdraw",
        occurredAt: "2026-08-19T04:00:00.000Z",
        ledger: new OwnerConfirmationLedger(ledgerRoot),
      }),
      (error: unknown) =>
        error instanceof OperatorAuthorityError && error.code === "AUTHORITY_TRANSITION_INVALID",
    );
    assert.deepEqual(await readdir(ledgerRoot), []);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  }
});
