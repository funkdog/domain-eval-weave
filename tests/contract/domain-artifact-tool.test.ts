import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import { assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";

import { createDomainArtifactDefinition } from "../../src/author-bridge/domain-artifact.js";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../src/contracts/canonical-json.js";
import {
  parseDomainSourceRef,
  parseProductDomainContractCandidate,
} from "../../src/domain/contracts.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

async function scratchWorkspace(prefix: string): Promise<string> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(`${parent}/${prefix}-`);
  await mkdir(`${workspace}/domain-eval`, { mode: 0o700 });
  return workspace;
}

test("domain_artifact publishes DSH-supported parameter and output schemas", async () => {
  const workspace = await scratchWorkspace("domain-artifact-schema");
  try {
    const tool = createDomainArtifactDefinition({ workspaceRoot: workspace });
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.parameters));
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.output.schema));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function expectFailure(result: unknown, code: string): void {
  assert.equal(typeof result, "object");
  assert.ok(result !== null);
  const failure = result as {
    readonly ok?: boolean;
    readonly diagnostics?: ReadonlyArray<{ readonly code?: string }>;
  };
  assert.equal(failure.ok, false);
  assert.ok(failure.diagnostics?.some((diagnostic) => diagnostic.code === code));
}

test("domain_artifact rejects the exact malformed author envelope with typed diagnostics", async () => {
  const workspace = await scratchWorkspace("domain-artifact-malformed");
  try {
    const tool = createDomainArtifactDefinition({ workspaceRoot: workspace });
    const malformed = {
      artifactType: "EvidenceCard",
      schemaVersion: "1",
      candidateId: "card-refund-policy-r1",
      productId: "synthetic-commerce",
      classification: "proposed",
      digest: { algorithm: "identity-utf8", value: "source bytes are not a digest" },
    };
    const result = await tool.execute({
      action: "write_artifact",
      kind: "evidence_card",
      artifact_ref: "evidence-cards/card-refund-policy/r1.json",
      value: malformed,
    });

    expectFailure(result, "ARTIFACT_SCHEMA_INVALID");
    await assert.rejects(
      readFile(`${workspace}/domain-eval/evidence-cards/card-refund-policy/r1.json`),
      /ENOENT/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("domain_artifact rejects a swapped workspace root before creating escaped directories", async () => {
  const workspace = await scratchWorkspace("domain-artifact-root-swap");
  const original = `${workspace}-original`;
  const outside = `${workspace}-outside`;
  await mkdir(outside, { mode: 0o700 });
  try {
    const tool = createDomainArtifactDefinition({ workspaceRoot: workspace });
    await rename(workspace, original);
    await symlink(outside, workspace);

    const result = await tool.execute({
      action: "snapshot_source",
      content: "Synthetic owner statement.\n",
      artifact_ref: "sources/owner-statement.md",
      source_id: "owner-statement",
      kind: "owner_statement",
    });

    expectFailure(result, "ARTIFACT_PATH_INVALID");
    await assert.rejects(stat(`${outside}/domain-eval`), /ENOENT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(original, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("domain_artifact snapshots real source bytes and writes/stages canonical immutable artifacts", async () => {
  const workspace = await scratchWorkspace("domain-artifact-canonical");
  try {
    const policyBytes = "Refunds never exceed captured cash.\n";
    await writeFile(`${workspace}/product-policy.md`, policyBytes, { mode: 0o600 });
    const tool = createDomainArtifactDefinition({ workspaceRoot: workspace });
    const snapshot = (await tool.execute({
      action: "snapshot_source",
      source_path: "product-policy.md",
      artifact_ref: "sources/product-policy.md",
      source_id: "refund-policy",
      kind: "product_doc",
      locator: "#cash-limit",
    })) as {
      readonly ok: boolean;
      readonly source_ref: unknown;
    };
    assert.equal(snapshot.ok, true);
    const sourceRef = parseDomainSourceRef(snapshot.source_ref);
    assert.deepEqual(sourceRef, {
      source_id: "refund-policy",
      kind: "product_doc",
      artifact_ref: "sources/product-policy.md",
      digest: sha256Hex(policyBytes),
      locator: "#cash-limit",
    });
    assert.equal(
      await readFile(`${workspace}/domain-eval/sources/product-policy.md`, "utf8"),
      policyBytes,
    );
    assert.equal(
      (await stat(`${workspace}/domain-eval/sources/product-policy.md`)).mode & 0o777,
      0o600,
    );

    const card = {
      schema_version: 1,
      card_id: "card-refund-policy",
      revision: 1,
      product_id: "synthetic-commerce",
      domain_id: "payments",
      claim_id: "refund-cash-limit",
      statement: "Refunds never exceed captured cash.",
      applicability: "Captured cash payments.",
      status: "proposed",
      source_refs: [sourceRef],
      authority_ref_ids: [sourceRef.source_id],
      observation_ref_ids: [],
      false_accept_risk: "critical",
      false_reject_risk: "high",
    } as const;
    const written = (await tool.execute({
      action: "write_artifact",
      kind: "evidence_card",
      artifact_ref: "evidence-cards/card-refund-policy/r1.json",
      value: card,
    })) as {
      readonly ok: boolean;
      readonly artifact: { readonly ref: string; readonly sha256: string };
    };
    assert.equal(written.ok, true);
    assert.deepEqual(written.artifact, {
      ref: "evidence-cards/card-refund-policy/r1.json",
      sha256: canonicalJsonDigest(card),
    });
    const canonicalBytes = `${canonicalJson(card)}\n`;
    assert.equal(
      await readFile(`${workspace}/domain-eval/${written.artifact.ref}`, "utf8"),
      canonicalBytes,
    );

    const repeated = await tool.execute({
      action: "write_artifact",
      kind: "evidence_card",
      artifact_ref: written.artifact.ref,
      value: card,
    });
    assert.equal((repeated as { readonly ok: boolean }).ok, true);

    const staged = (await tool.execute({
      action: "stage_confirmation_candidate",
      target_kind: "evidence_card",
      artifact: written.artifact,
      candidate_ref: "candidates/card-refund-policy-r1.json",
    })) as {
      readonly ok: boolean;
      readonly artifact: { readonly ref: string; readonly sha256: string };
    };
    assert.equal(staged.ok, true);
    assert.deepEqual(staged.artifact, {
      ref: "candidates/card-refund-policy-r1.json",
      sha256: canonicalJsonDigest(card),
    });
    assert.equal(
      await readFile(`${workspace}/domain-eval/${staged.artifact.ref}`, "utf8"),
      canonicalBytes,
    );

    const conflict = await tool.execute({
      action: "write_artifact",
      kind: "evidence_card",
      artifact_ref: written.artifact.ref,
      value: { ...card, statement: "Different bytes." },
    });
    expectFailure(conflict, "ARTIFACT_IMMUTABLE_CONFLICT");
    assert.equal(
      await readFile(`${workspace}/domain-eval/${written.artifact.ref}`, "utf8"),
      canonicalBytes,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("domain_artifact binds JSON Pointer source values and outbound artifact pointers", async () => {
  const workspace = await scratchWorkspace("domain-artifact-pointer");
  try {
    const policy = { policy: { limit: 2, unit: "captured_payment" } };
    await writeFile(`${workspace}/policy.json`, JSON.stringify(policy), { mode: 0o600 });
    const tool = createDomainArtifactDefinition({ workspaceRoot: workspace });
    const snapshot = (await tool.execute({
      action: "snapshot_source",
      source_path: "policy.json",
      artifact_ref: "sources/policy.json",
      source_id: "refund-limit-json",
      kind: "product_doc",
      locator: "/policy/limit",
    })) as { readonly ok: boolean; readonly source_ref: { readonly digest: string } };
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.source_ref.digest, canonicalJsonDigest(2));

    const ownerAnswer = "The owner explicitly keeps the refund cap.";
    const ownerSnapshot = (await tool.execute({
      action: "snapshot_source",
      content: ownerAnswer,
      artifact_ref: "sources/owner-refund-answer.txt",
      source_id: "owner-refund-answer",
      kind: "owner_statement",
    })) as { readonly ok: boolean; readonly source_ref: { readonly digest: string } };
    assert.equal(ownerSnapshot.ok, true);
    assert.equal(ownerSnapshot.source_ref.digest, sha256Hex(ownerAnswer));
    assert.equal(
      await readFile(`${workspace}/domain-eval/sources/owner-refund-answer.txt`, "utf8"),
      ownerAnswer,
    );

    const sourceRef = parseDomainSourceRef(snapshot.source_ref);
    const card = {
      schema_version: 1,
      card_id: "card-json-limit",
      revision: 1,
      product_id: "synthetic-commerce",
      domain_id: "payments",
      claim_id: "refund-json-limit",
      statement: "Refund limit is two units.",
      applicability: "JSON policy cases.",
      status: "unresolved",
      source_refs: [sourceRef],
      authority_ref_ids: [],
      observation_ref_ids: [],
      false_accept_risk: "high",
      false_reject_risk: "medium",
    } as const;
    const cardWrite = (await tool.execute({
      action: "write_artifact",
      kind: "evidence_card",
      artifact_ref: "evidence-cards/card-json-limit/r1.json",
      value: card,
    })) as {
      readonly ok: boolean;
      readonly artifact: { readonly ref: string; readonly sha256: string };
    };
    assert.equal(cardWrite.ok, true);

    const interview = {
      schema_version: 1,
      interview_id: "commerce-onboard-helper",
      revision: 1,
      mode: "onboard",
      product_id: "synthetic-commerce",
      domain_ids: ["payments"],
      source_snapshot: [sourceRef],
      turns: [],
      evidence_card_refs: [cardWrite.artifact],
      decision_question_refs: [],
      status: "completed",
      started_at: "2026-08-19T00:00:00.000Z",
      ended_at: "2026-08-19T00:01:00.000Z",
    } as const;
    const interviewWrite = await tool.execute({
      action: "write_artifact",
      kind: "interview_session",
      artifact_ref: "interviews/commerce-onboard-helper/r1.json",
      value: interview,
    });
    assert.equal((interviewWrite as { readonly ok: boolean }).ok, true);

    const drifted = await tool.execute({
      action: "write_artifact",
      kind: "interview_session",
      artifact_ref: "interviews/commerce-onboard-drift/r1.json",
      value: {
        ...interview,
        interview_id: "commerce-onboard-drift",
        evidence_card_refs: [{ ...cardWrite.artifact, sha256: "f".repeat(64) }],
      },
    });
    expectFailure(drifted, "ARTIFACT_POINTER_DRIFT");
    await assert.rejects(
      readFile(`${workspace}/domain-eval/interviews/commerce-onboard-drift/r1.json`),
      /ENOENT/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("domain_artifact derives Contract snapshot digest and never authors authority faces", async () => {
  const workspace = await scratchWorkspace("domain-artifact-contract");
  try {
    await writeFile(`${workspace}/policy.md`, "Refunds are capped.\n", { mode: 0o600 });
    const tool = createDomainArtifactDefinition({ workspaceRoot: workspace });
    const snapshot = (await tool.execute({
      action: "snapshot_source",
      source_path: "policy.md",
      artifact_ref: "sources/refund-policy.md",
      source_id: "refund-policy",
      kind: "product_doc",
    })) as { readonly ok: boolean; readonly source_ref: unknown };
    assert.equal(snapshot.ok, true);
    const sourceRef = parseDomainSourceRef(snapshot.source_ref);

    const confirmedCard = {
      schema_version: 1,
      card_id: "confirmed-refund-card",
      revision: 1,
      product_id: "synthetic-commerce",
      domain_id: "payments",
      claim_id: "refund-limit",
      statement: "Refunds are capped.",
      applicability: "Captured payments.",
      status: "confirmed",
      source_refs: [sourceRef],
      authority_ref_ids: [sourceRef.source_id],
      observation_ref_ids: [],
      false_accept_risk: "critical",
      false_reject_risk: "high",
      confirmation: {
        confirmation_id: "management-confirmed-card",
        sha256: "a".repeat(64),
      },
    } as const;
    const confirmedRef = "evidence-cards/confirmed-refund-card/r1.json";
    await mkdir(`${workspace}/domain-eval/evidence-cards/confirmed-refund-card`, {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      `${workspace}/domain-eval/${confirmedRef}`,
      `${canonicalJson(confirmedCard)}\n`,
      { mode: 0o600 },
    );
    const confirmedPointer = {
      ref: confirmedRef,
      sha256: canonicalJsonDigest(confirmedCard),
    };

    const interview = {
      schema_version: 1,
      interview_id: "contract-source-interview",
      revision: 1,
      mode: "onboard",
      product_id: "synthetic-commerce",
      domain_ids: ["payments"],
      source_snapshot: [sourceRef],
      turns: [],
      evidence_card_refs: [confirmedPointer],
      decision_question_refs: [],
      status: "completed",
      started_at: "2026-08-19T00:00:00.000Z",
      ended_at: "2026-08-19T00:01:00.000Z",
    } as const;
    const interviewWrite = (await tool.execute({
      action: "write_artifact",
      kind: "interview_session",
      artifact_ref: "interviews/contract-source-interview/r1.json",
      value: interview,
    })) as {
      readonly ok: boolean;
      readonly artifact: { readonly ref: string; readonly sha256: string };
    };
    assert.equal(interviewWrite.ok, true);

    const candidateWithoutDerivedDigest = {
      schema_version: 1,
      contract_id: "synthetic-commerce-contract",
      product_id: "synthetic-commerce",
      version: 1,
      source_interview: interviewWrite.artifact,
      claims: [
        {
          claim_id: confirmedCard.claim_id,
          domain_id: confirmedCard.domain_id,
          statement: confirmedCard.statement,
          applicability: confirmedCard.applicability,
          evidence_card: confirmedPointer,
          authority_refs: [sourceRef],
          observation_refs: [],
          false_accept_risk: confirmedCard.false_accept_risk,
          false_reject_risk: confirmedCard.false_reject_risk,
          dependencies: [],
          lifecycle: "active",
        },
      ],
    } as const;
    const contractWrite = (await tool.execute({
      action: "write_artifact",
      kind: "product_domain_contract_candidate",
      artifact_ref: "candidates/synthetic-commerce-contract-v1.json",
      value: candidateWithoutDerivedDigest,
    })) as { readonly ok: boolean; readonly artifact: { readonly ref: string } };
    assert.equal(contractWrite.ok, true);
    const writtenContract = parseProductDomainContractCandidate(
      JSON.parse(await readFile(`${workspace}/domain-eval/${contractWrite.artifact.ref}`, "utf8")),
    );
    assert.equal(
      writtenContract.source_snapshot_digest,
      canonicalJsonDigest(interview.source_snapshot),
    );

    const forbidden = await tool.execute({
      action: "write_artifact",
      kind: "evidence_card",
      artifact_ref: confirmedRef,
      value: confirmedCard,
    });
    expectFailure(forbidden, "ARTIFACT_AUTHORITY_FORBIDDEN");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("domain_artifact rejects escape, symlink, sensitive path, and secret-shaped content without writes", async () => {
  const workspace = await scratchWorkspace("domain-artifact-boundary");
  const outside = `${workspace}-outside`;
  await mkdir(outside, { mode: 0o700 });
  try {
    await writeFile(`${outside}/policy.md`, "outside\n", { mode: 0o600 });
    await symlink(`${outside}/policy.md`, `${workspace}/linked-policy.md`);
    await mkdir(`${workspace}/domain-eval/sources`, { mode: 0o700 });
    await symlink(outside, `${workspace}/domain-eval/sources/escape`);
    await writeFile(`${workspace}/.env`, "SAFE_NAME=value\n", { mode: 0o600 });
    await writeFile(`${workspace}/safe.md`, "safe source\n", { mode: 0o600 });
    await writeFile(`${workspace}/policy-private.txt`, "Authorization: Bearer synthetic-secret\n", {
      mode: 0o600,
    });
    await writeFile(`${workspace}/credential.txt`, "ordinary text\n", { mode: 0o600 });
    await writeFile(`${workspace}/oauth.json`, '{"id_token":"synthetic-opaque-value"}\n', {
      mode: 0o600,
    });
    await writeFile(`${workspace}/oauthToken.json`, '{"oauthToken":"synthetic-opaque-value"}\n', {
      mode: 0o600,
    });
    await writeFile(`${workspace}/oAuthToken.json`, '{"oAuthToken":"synthetic-opaque-value"}\n', {
      mode: 0o600,
    });
    await writeFile(`${workspace}/authToken.json`, '{"authToken":"synthetic-opaque-value"}\n', {
      mode: 0o600,
    });
    await writeFile(`${workspace}/apiToken.json`, '{"apiToken":"synthetic-opaque-value"}\n', {
      mode: 0o600,
    });
    await writeFile(`${workspace}/APIToken.json`, '{"APIToken":"synthetic-opaque-value"}\n', {
      mode: 0o600,
    });
    await writeFile(
      `${workspace}/authenticationToken.json`,
      '{"authenticationToken":"synthetic-opaque-value"}\n',
      { mode: 0o600 },
    );
    await writeFile(`${workspace}/config.json`, '{"userAuthToken":"synthetic-opaque-value"}\n', {
      mode: 0o600,
    });
    await writeFile(`${workspace}/provider-config.json`, '{"githubToken":"synthetic"}\n', {
      mode: 0o600,
    });
    const tool = createDomainArtifactDefinition({ workspaceRoot: workspace });

    for (const sourcePath of [
      "../domain-artifact-boundary-outside/policy.md",
      "linked-policy.md",
    ]) {
      const result = await tool.execute({
        action: "snapshot_source",
        source_path: sourcePath,
        artifact_ref: "sources/rejected.md",
        source_id: "rejected-source",
        kind: "product_doc",
      });
      expectFailure(result, "ARTIFACT_PATH_INVALID");
    }

    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: ".env",
        artifact_ref: "sources/env.txt",
        source_id: "env-source",
        kind: "product_doc",
      }),
      "ARTIFACT_PATH_FORBIDDEN",
    );
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "policy-private.txt",
        artifact_ref: "sources/credential.txt",
        source_id: "credential-source",
        kind: "product_doc",
      }),
      "SECRET_PATTERN_DETECTED",
    );
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "credential.txt",
        artifact_ref: "sources/credential-name.txt",
        source_id: "credential-name-source",
        kind: "product_doc",
      }),
      "ARTIFACT_PATH_FORBIDDEN",
    );
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "oauth.json",
        artifact_ref: "sources/oauth.json",
        source_id: "oauth-source",
        kind: "product_doc",
      }),
      "ARTIFACT_PATH_FORBIDDEN",
    );
    await assert.rejects(readFile(`${workspace}/domain-eval/sources/oauth.json`), /ENOENT/);
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "oauthToken.json",
        artifact_ref: "sources/oauthToken.json",
        source_id: "oauth-token-source",
        kind: "product_doc",
      }),
      "ARTIFACT_PATH_FORBIDDEN",
    );
    await assert.rejects(readFile(`${workspace}/domain-eval/sources/oauthToken.json`), /ENOENT/);
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "oAuthToken.json",
        artifact_ref: "sources/oAuthToken.json",
        source_id: "oauth-token-alternate-case-source",
        kind: "product_doc",
      }),
      "ARTIFACT_PATH_FORBIDDEN",
    );
    await assert.rejects(readFile(`${workspace}/domain-eval/sources/oAuthToken.json`), /ENOENT/);
    for (const credentialStem of ["authToken", "apiToken", "APIToken"]) {
      expectFailure(
        await tool.execute({
          action: "snapshot_source",
          source_path: `${credentialStem}.json`,
          artifact_ref: `sources/${credentialStem}.json`,
          source_id: `${credentialStem}-source`,
          kind: "product_doc",
        }),
        "ARTIFACT_PATH_FORBIDDEN",
      );
      await assert.rejects(
        readFile(`${workspace}/domain-eval/sources/${credentialStem}.json`),
        /ENOENT/,
      );
    }
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "authenticationToken.json",
        artifact_ref: "sources/authenticationToken.json",
        source_id: "authentication-token-source",
        kind: "product_doc",
      }),
      "ARTIFACT_PATH_FORBIDDEN",
    );
    await assert.rejects(
      readFile(`${workspace}/domain-eval/sources/authenticationToken.json`),
      /ENOENT/,
    );
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "config.json",
        artifact_ref: "sources/config.json",
        source_id: "composite-credential-source",
        kind: "product_doc",
      }),
      "SECRET_PATTERN_DETECTED",
    );
    await assert.rejects(readFile(`${workspace}/domain-eval/sources/config.json`), /ENOENT/);
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "provider-config.json",
        artifact_ref: "sources/provider-config.json",
        source_id: "provider-credential-source",
        kind: "product_doc",
      }),
      "SECRET_PATTERN_DETECTED",
    );
    await assert.rejects(
      readFile(`${workspace}/domain-eval/sources/provider-config.json`),
      /ENOENT/,
    );
    expectFailure(
      await tool.execute({
        action: "snapshot_source",
        source_path: "safe.md",
        artifact_ref: "sources/escape/copied.txt",
        source_id: "escape-source",
        kind: "product_doc",
      }),
      "ARTIFACT_PATH_INVALID",
    );
    await assert.rejects(readFile(`${outside}/copied.txt`), /ENOENT/);

    const secretValue = {
      schema_version: 1,
      card_id: "card-secret",
      revision: 1,
      product_id: "synthetic-commerce",
      domain_id: "payments",
      claim_id: "secret-claim",
      statement: "Authorization: Bearer synthetic-secret",
      applicability: "Never persisted.",
      status: "proposed",
      source_refs: [
        {
          source_id: "missing",
          kind: "product_doc",
          artifact_ref: "sources/missing.md",
          digest: "a".repeat(64),
        },
      ],
      authority_ref_ids: ["missing"],
      observation_ref_ids: [],
      false_accept_risk: "high",
      false_reject_risk: "high",
    };
    expectFailure(
      await tool.execute({
        action: "write_artifact",
        kind: "evidence_card",
        artifact_ref: "evidence-cards/card-secret/r1.json",
        value: secretValue,
      }),
      "SECRET_PATTERN_DETECTED",
    );
    await assert.rejects(
      readFile(`${workspace}/domain-eval/evidence-cards/card-secret/r1.json`),
      /ENOENT/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
