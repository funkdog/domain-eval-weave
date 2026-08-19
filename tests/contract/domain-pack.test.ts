import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson, canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { buildClaimDependencyGraph, impactedByClaim } from "../../src/domain/graph.js";
import { recordOperatorAuthority } from "../../src/domain/operator-authority.js";
import { DomainPackError, validateDomainPack } from "../../src/domain/pack.js";
import { buildDomainTruthReadiness } from "../../src/domain/readiness.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { writeSyntheticDomainPack } from "../helpers/domain-pack-fixture.js";

async function scratchProject(prefix: string): Promise<string> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(`${parent}/${prefix}-`);
}

test("domain pack validates source locators, primary digests, graph replay, and readiness", async () => {
  const project = await scratchProject("domain-pack-valid");
  try {
    const { manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const pack = await validateDomainPack(project, "domain-eval", manifestRef, {
      confirmationLedger,
    });
    assert.equal(pack.readiness.overall, "green");
    assert.deepEqual(impactedByClaim(pack.graph, "refund-cash-limit"), {
      dependent_claim_ids: [],
      proposed_claim_ids: [],
      requirement_ids: ["order-cancellation-v1", "partial-refund-v1"],
    });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack rejects graph drift and owner-answer source drift", async () => {
  const project = await scratchProject("domain-pack-drift");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifest = JSON.parse(await readFile(`${packRoot}/${manifestRef}`, "utf8")) as {
      graph: { ref: string };
    };
    const graphPath = `${packRoot}/${manifest.graph.ref}`;
    const graph = JSON.parse(await readFile(graphPath, "utf8")) as Record<string, unknown>;
    graph.reverse_index = {};
    await writeFile(graphPath, `${canonicalJson(graph)}\n`, "utf8");
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );

    await writeSyntheticDomainPack(project);
    const interviewPath = `${packRoot}/interviews/commerce-onboard-v1/r1.json`;
    const interview = JSON.parse(await readFile(interviewPath, "utf8")) as {
      turns: Array<{ answer: string }>;
    };
    const firstTurn = interview.turns[0];
    assert.ok(firstTurn);
    firstTurn.answer = "A mutated policy answer.";
    await writeFile(interviewPath, `${canonicalJson(interview)}\n`, "utf8");
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack rejects a dangling Interview evidence-card pointer", async () => {
  const project = await scratchProject("domain-pack-interview-card");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifestPath = `${packRoot}/${manifestRef}`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      interviews: Array<{ ref: string; sha256: string }>;
    };
    const interviewPointer = manifest.interviews[0];
    assert.ok(interviewPointer);
    const interviewPath = `${packRoot}/${interviewPointer.ref}`;
    const interview = JSON.parse(await readFile(interviewPath, "utf8")) as {
      evidence_card_refs: Array<{ ref: string; sha256: string }>;
    };
    interview.evidence_card_refs = [
      { ref: "evidence-cards/missing/r1.json", sha256: "a".repeat(64) },
    ];
    await writeFile(interviewPath, `${canonicalJson(interview)}\n`, { mode: 0o600 });
    interviewPointer.sha256 = canonicalJsonDigest(interview);
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack replays contiguous predecessor revisions instead of trusting only current bytes", async () => {
  const project = await scratchProject("domain-pack-predecessor");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifestPath = `${packRoot}/${manifestRef}`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      interviews: Array<{ ref: string; sha256: string }>;
    };
    const currentPointer = manifest.interviews[0];
    assert.ok(currentPointer);
    const revisionOne = JSON.parse(
      await readFile(`${packRoot}/${currentPointer.ref}`, "utf8"),
    ) as Record<string, unknown>;
    const revisionTwo = {
      ...revisionOne,
      revision: 2,
      predecessor: {
        ref: currentPointer.ref,
        sha256: canonicalJsonDigest(revisionOne),
      },
    };
    const revisionTwoRef = "interviews/commerce-onboard-v1/r2.json";
    await writeFile(`${packRoot}/${revisionTwoRef}`, `${canonicalJson(revisionTwo)}\n`, {
      mode: 0o600,
    });
    manifest.interviews = [{ ref: revisionTwoRef, sha256: canonicalJsonDigest(revisionTwo) }];
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
    await assert.doesNotReject(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
    );

    (revisionTwo.predecessor as { sha256: string }).sha256 = "f".repeat(64);
    await writeFile(`${packRoot}/${revisionTwoRef}`, `${canonicalJson(revisionTwo)}\n`, {
      mode: 0o600,
    });
    manifest.interviews = [{ ref: revisionTwoRef, sha256: canonicalJsonDigest(revisionTwo) }];
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack replays outbound pointers from historical Interview revisions", async () => {
  const project = await scratchProject("domain-pack-historical-outbound");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifestPath = `${packRoot}/${manifestRef}`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      interviews: Array<{ ref: string; sha256: string }>;
    };
    const revisionOnePointer = manifest.interviews[0];
    assert.ok(revisionOnePointer);
    const revisionOnePath = `${packRoot}/${revisionOnePointer.ref}`;
    const original = JSON.parse(await readFile(revisionOnePath, "utf8")) as Record<string, unknown>;
    const historical = {
      ...original,
      evidence_card_refs: [{ ref: "evidence-cards/missing/r1.json", sha256: "a".repeat(64) }],
    };
    await writeFile(revisionOnePath, `${canonicalJson(historical)}\n`, { mode: 0o600 });
    const revisionTwo = {
      ...original,
      revision: 2,
      predecessor: {
        ref: revisionOnePointer.ref,
        sha256: canonicalJsonDigest(historical),
      },
    };
    const revisionTwoRef = "interviews/commerce-onboard-v1/r2.json";
    await writeFile(`${packRoot}/${revisionTwoRef}`, `${canonicalJson(revisionTwo)}\n`, {
      mode: 0o600,
    });
    manifest.interviews = [{ ref: revisionTwoRef, sha256: canonicalJsonDigest(revisionTwo) }];
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });

    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack rejects cross-product Interviews and forged historical Card receipts", async () => {
  const project = await scratchProject("domain-pack-product-history");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifestPath = `${packRoot}/${manifestRef}`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      interviews: Array<{ ref: string; sha256: string }>;
      evidence_cards: Array<{ ref: string; sha256: string }>;
    };
    const interviewPointer = manifest.interviews[0];
    const cardPointer = manifest.evidence_cards[0];
    assert.ok(interviewPointer);
    assert.ok(cardPointer);
    const interviewPath = `${packRoot}/${interviewPointer.ref}`;
    const originalInterview = JSON.parse(await readFile(interviewPath, "utf8")) as Record<
      string,
      unknown
    >;
    const wrongProductInterview = {
      ...originalInterview,
      product_id: "other-product",
      evidence_card_refs: [],
      decision_question_refs: [],
    };
    await writeFile(interviewPath, `${canonicalJson(wrongProductInterview)}\n`, {
      mode: 0o600,
    });
    interviewPointer.sha256 = canonicalJsonDigest(wrongProductInterview);
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );

    await writeSyntheticDomainPack(project);
    const restoredManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      interviews: Array<{ ref: string; sha256: string }>;
      evidence_cards: Array<{ ref: string; sha256: string }>;
    };
    const restoredInterviewPointer = restoredManifest.interviews[0];
    const restoredCardPointer = restoredManifest.evidence_cards[0];
    assert.ok(restoredInterviewPointer);
    assert.ok(restoredCardPointer);
    const restoredInterview = JSON.parse(
      await readFile(`${packRoot}/${restoredInterviewPointer.ref}`, "utf8"),
    ) as Record<string, unknown>;
    const existingCard = JSON.parse(
      await readFile(`${packRoot}/${restoredCardPointer.ref}`, "utf8"),
    ) as Record<string, unknown>;
    const forgedCard = { ...existingCard, card_id: "forged-history-card" };
    const forgedCardRef = "candidates/forged-history-card.json";
    await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
    await writeFile(`${packRoot}/${forgedCardRef}`, `${canonicalJson(forgedCard)}\n`, {
      mode: 0o600,
    });
    const historical = {
      ...restoredInterview,
      evidence_card_refs: [{ ref: forgedCardRef, sha256: canonicalJsonDigest(forgedCard) }],
    };
    await writeFile(
      `${packRoot}/${restoredInterviewPointer.ref}`,
      `${canonicalJson(historical)}\n`,
      { mode: 0o600 },
    );
    const revisionTwo = {
      ...restoredInterview,
      revision: 2,
      predecessor: {
        ref: restoredInterviewPointer.ref,
        sha256: canonicalJsonDigest(historical),
      },
    };
    const revisionTwoRef = "interviews/commerce-onboard-v1/r2.json";
    await writeFile(`${packRoot}/${revisionTwoRef}`, `${canonicalJson(revisionTwo)}\n`, {
      mode: 0o600,
    });
    restoredManifest.interviews = [
      { ref: revisionTwoRef, sha256: canonicalJsonDigest(revisionTwo) },
    ];
    await writeFile(manifestPath, `${canonicalJson(restoredManifest)}\n`, { mode: 0o600 });
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack path rejects traversal, absolute paths, and symlink roots", async () => {
  const project = await scratchProject("domain-pack-path");
  const outside = await scratchProject("domain-pack-outside");
  try {
    await writeSyntheticDomainPack(outside);
    await symlink(`${outside}/domain-eval`, `${project}/linked-pack`);
    for (const ref of ["../outside/domain-eval", `${outside}/domain-eval`, "linked-pack"]) {
      await assert.rejects(
        validateDomainPack(project, ref, "manifests/snapshot-synthetic-commerce-v1.json"),
        DomainPackError,
      );
    }
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("domain pack replays a retired Claim carried unchanged into the next Contract", async () => {
  const project = await scratchProject("domain-pack-retired-carry");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifest = JSON.parse(await readFile(`${packRoot}/${manifestRef}`, "utf8")) as {
      schema_version: 1;
      snapshot_id: string;
      product_id: string;
      contract: { ref: string; sha256: string };
      interviews: Array<{ ref: string; sha256: string }>;
      evidence_cards: Array<{ ref: string; sha256: string }>;
      confirmations: Array<{ confirmation_id: string; sha256: string }>;
      decision_questions: Array<{ ref: string; sha256: string }>;
      requirements: Array<{ ref: string; sha256: string }>;
      graph: { ref: string; sha256: string };
      readiness_request: { ref: string; sha256: string };
      readiness_report: { ref: string; sha256: string };
    };
    const versionOne = JSON.parse(
      await readFile(`${packRoot}/${manifest.contract.ref}`, "utf8"),
    ) as Record<string, unknown>;
    const {
      state: _state,
      confirmation: _confirmation,
      decided_by: _by,
      decided_at: _at,
      ...versionOneBase
    } = versionOne;
    const versionTwoCandidate = {
      ...versionOneBase,
      version: 2,
      predecessor: {
        ref: manifest.contract.ref,
        sha256: canonicalJsonDigest(versionOne),
      },
      claims: (versionOneBase.claims as Array<Record<string, unknown>>).map((claim) => ({
        ...claim,
        lifecycle: "retired",
        transition: {
          kind: "retires",
          predecessor: { claim_id: claim.claim_id, contract_version: 1 },
        },
      })),
    };
    await mkdir(`${packRoot}/candidates`, { recursive: true, mode: 0o700 });
    await writeFile(
      `${packRoot}/candidates/retired-contract-v2.json`,
      `${canonicalJson(versionTwoCandidate)}\n`,
      { mode: 0o600 },
    );
    const versionTwoResult = await recordOperatorAuthority({
      projectRoot: project,
      packPath: "domain-eval",
      candidatePath: "candidates/retired-contract-v2.json",
      targetKind: "product_domain_contract",
      actorId: "domain-owner-commerce",
      occurredAt: "2026-08-19T05:00:00.000Z",
      ledger: confirmationLedger,
    });
    assert.ok(versionTwoResult.artifact);
    const versionTwo = versionTwoResult.artifact.value as Record<string, unknown>;
    const versionThreeCandidate = {
      ...versionTwoCandidate,
      version: 3,
      predecessor: {
        ref: versionTwoResult.artifact.ref,
        sha256: canonicalJsonDigest(versionTwo),
      },
      claims: (versionTwoCandidate.claims as Array<Record<string, unknown>>).map(
        ({ transition: _transition, ...claim }) => claim,
      ),
    };
    await writeFile(
      `${packRoot}/candidates/retired-contract-v3.json`,
      `${canonicalJson(versionThreeCandidate)}\n`,
      { mode: 0o600 },
    );
    const versionThreeResult = await recordOperatorAuthority({
      projectRoot: project,
      packPath: "domain-eval",
      candidatePath: "candidates/retired-contract-v3.json",
      targetKind: "product_domain_contract",
      actorId: "domain-owner-commerce",
      occurredAt: "2026-08-19T05:01:00.000Z",
      ledger: confirmationLedger,
    });
    assert.ok(versionThreeResult.artifact);
    const versionThree = versionThreeResult.artifact.value;
    const contractPointer = {
      ref: versionThreeResult.artifact.ref,
      sha256: canonicalJsonDigest(versionThree),
    };

    const requirementArtifacts = [];
    for (const pointer of manifest.requirements) {
      const requirement = JSON.parse(
        await readFile(`${packRoot}/${pointer.ref}`, "utf8"),
      ) as Record<string, unknown>;
      const { confirmation: _requirementConfirmation, ...requirementBase } = requirement;
      const effects = requirementBase.effects as Record<string, Array<Record<string, unknown>>>;
      const reversion = (claim: Record<string, unknown>) => ({ ...claim, contract_version: 3 });
      const candidate = {
        ...requirementBase,
        version: 2,
        predecessor: pointer,
        base_contract: contractPointer,
        effects: {
          ...effects,
          uses: (effects.uses ?? []).map(reversion),
          preserves: (effects.preserves ?? []).map(reversion),
          modifies: (effects.modifies ?? []).map((entry) => ({
            ...entry,
            claim: reversion(entry.claim as Record<string, unknown>),
          })),
          deprecates: (effects.deprecates ?? []).map(reversion),
          conflicts_with: (effects.conflicts_with ?? []).map((entry) => ({
            ...entry,
            claim: reversion(entry.claim as Record<string, unknown>),
          })),
        },
        status: "draft",
      };
      const candidateRef = `candidates/${String(requirement.requirement_id)}-v2.json`;
      await writeFile(`${packRoot}/${candidateRef}`, `${canonicalJson(candidate)}\n`, {
        mode: 0o600,
      });
      const result = await recordOperatorAuthority({
        projectRoot: project,
        packPath: "domain-eval",
        candidatePath: candidateRef,
        targetKind: "requirement_change_set",
        actorId: "domain-owner-commerce",
        occurredAt: "2026-08-19T05:02:00.000Z",
        ledger: confirmationLedger,
      });
      assert.ok(result.artifact);
      requirementArtifacts.push({
        ref: result.artifact.ref,
        requirement: result.artifact.value,
        confirmation: result.confirmation,
      });
    }

    const graph = buildClaimDependencyGraph({
      contract: { ref: contractPointer.ref, contract: versionThree },
      requirements: requirementArtifacts,
    });
    const graphRef = `graphs/${graph.graph_id}.json`;
    const oldRequest = JSON.parse(
      await readFile(`${packRoot}/${manifest.readiness_request.ref}`, "utf8"),
    ) as Record<string, unknown>;
    const request = {
      ...oldRequest,
      request_id: "readiness-retired-carry-v3",
      requirements: requirementArtifacts.map((artifact) => ({
        ref: artifact.ref,
        sha256: canonicalJsonDigest(artifact.requirement),
      })),
      requested_at: "2026-08-19T05:03:00.000Z",
    };
    const requestRef = `readiness/requests/${String(request.request_id)}.json`;
    const evidenceCards = await Promise.all(
      manifest.evidence_cards.map(async (pointer) => ({
        ref: pointer.ref,
        card: JSON.parse(await readFile(`${packRoot}/${pointer.ref}`, "utf8")),
      })),
    );
    const decisionQuestions = await Promise.all(
      manifest.decision_questions.map(async (pointer) => ({
        ref: pointer.ref,
        question: JSON.parse(await readFile(`${packRoot}/${pointer.ref}`, "utf8")),
      })),
    );
    const readiness = buildDomainTruthReadiness({
      contract: contractPointer,
      requirements: requirementArtifacts,
      graph: { ref: graphRef, graph },
      evidenceCards,
      decisionQuestions,
      request: { ref: requestRef, request },
      generatedAt: "2026-08-19T05:04:00.000Z",
    });
    const reportRef = `readiness/reports/${readiness.report_id}.json`;
    const nextManifest = {
      ...manifest,
      snapshot_id: "snapshot-synthetic-commerce-retired-v3",
      contract: contractPointer,
      confirmations: [
        ...manifest.confirmations,
        versionTwoResult.confirmation,
        versionThreeResult.confirmation,
        ...requirementArtifacts.map((artifact) => artifact.confirmation),
      ],
      requirements: request.requirements,
      graph: { ref: graphRef, sha256: canonicalJsonDigest(graph) },
      readiness_request: { ref: requestRef, sha256: canonicalJsonDigest(request) },
      readiness_report: { ref: reportRef, sha256: canonicalJsonDigest(readiness) },
    };
    const nextManifestRef = `manifests/${nextManifest.snapshot_id}.json`;
    await Promise.all([
      writeFile(`${packRoot}/${graphRef}`, `${canonicalJson(graph)}\n`, { mode: 0o600 }),
      writeFile(`${packRoot}/${requestRef}`, `${canonicalJson(request)}\n`, { mode: 0o600 }),
      writeFile(`${packRoot}/${reportRef}`, `${canonicalJson(readiness)}\n`, { mode: 0o600 }),
      writeFile(`${packRoot}/${nextManifestRef}`, `${canonicalJson(nextManifest)}\n`, {
        mode: 0o600,
      }),
    ]);
    const pack = await validateDomainPack(project, "domain-eval", nextManifestRef, {
      confirmationLedger,
    });
    assert.equal(pack.contract.version, 3);
    assert.equal(pack.contract.claims[0]?.lifecycle, "retired");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
