import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createDomainArtifactDefinition } from "../../src/author-bridge/domain-artifact.js";
import applyDshEvalAuthorBridge, { createAuthorToolGuard } from "../../src/author-bridge/index.js";
import {
  createForwardAttemptRecorder,
  evaluateUnauthorizedTruth,
  FORWARD_RUN_NONCE_ENV,
  FORWARD_RUN_ROOT_ENV,
  ForwardEvidenceStore,
  readForwardEvidenceRoot,
} from "../../src/author-evidence/index.js";
import { AuthorForwardCarrier } from "../../src/carrier/author-forward.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const DIGEST = "a".repeat(64);

function syntheticCarrier(): AuthorForwardCarrier {
  return new AuthorForwardCarrier({ verifyModelSettings: async () => undefined });
}

async function scratch(prefix: string): Promise<string> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(`${parent}/${prefix}-`);
}

function runMetadata(runId: string) {
  return {
    runId,
    sourceRevision: "a".repeat(40),
    packageTar: { sha256: "b".repeat(64), size: 123 },
    profile: "eval-clowder-author",
    provider: "synthetic-provider",
    model: "synthetic-model",
    effort: "high",
    promptSha256: "c".repeat(64),
    fixtureSetSha256: "d".repeat(64),
    startedAt: "2026-08-19T00:00:00.000Z",
  } as const;
}

test("carrier receipt excludes a complete-looking PI_AI_ERROR run from the admitted cohort", async () => {
  const root = await scratch("forward-carrier");
  const evidenceRoot = `${root}/evidence`;
  const workspace = `${root}/workspace`;
  const packageTarPath = `${root}/synthetic.tgz`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await writeFile(packageTarPath, "synthetic reviewed package", { mode: 0o600 });
  try {
    const result = await syntheticCarrier().run({
      executable: process.execPath,
      launcherArgs: [
        "-e",
        "process.stdout.write('final output\\n');process.stderr.write('PI_AI_ERROR synthetic\\n')",
        "--",
      ],
      workspace,
      task: "synthetic forward prompt",
      timeoutMs: 5_000,
      evidenceRoot,
      runId: "complete-looking-error",
      sourceRevision: "a".repeat(40),
      packageTarPath,
      fixtureSetSha256: "d".repeat(64),
    });

    assert.equal(result.receipt.admission, "failed");
    assert.deepEqual(result.receipt.error_markers, ["PI_AI_ERROR"]);
    assert.equal(result.receipt.final_output_seen, true);
    const evidence = await readForwardEvidenceRoot(evidenceRoot);
    assert.deepEqual(evidence.admitted_run_ids, []);
    assert.deepEqual(evidence.failed_run_ids, ["complete-looking-error"]);
    assert.equal(evidence.runs[0]?.descriptor.provider, "openai-codex");
    assert.equal(evidence.runs[0]?.descriptor.model, "gpt-5.6-sol");
    assert.equal(evidence.runs[0]?.descriptor.effort, "xhigh");
    assert.equal(
      (await stat(`${evidenceRoot}/runs/complete-looking-error/receipt.json`)).mode & 0o777,
      0o600,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("carrier verifies the frozen model route before opening a run", async () => {
  const root = await scratch("forward-model-route");
  const evidenceRoot = `${root}/evidence`;
  const workspace = `${root}/workspace`;
  const packageTarPath = `${root}/synthetic.tgz`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await writeFile(packageTarPath, "synthetic reviewed package", { mode: 0o600 });
  try {
    const carrier = new AuthorForwardCarrier({
      verifyModelSettings: async () => {
        throw new Error("synthetic route mismatch");
      },
    });
    await assert.rejects(
      carrier.run({
        executable: process.execPath,
        workspace,
        task: "synthetic forward prompt",
        timeoutMs: 5_000,
        evidenceRoot,
        runId: "route-mismatch",
        sourceRevision: "a".repeat(40),
        packageTarPath,
        fixtureSetSha256: "d".repeat(64),
      }),
      /synthetic route mismatch/,
    );
    const evidence = await readForwardEvidenceRoot(evidenceRoot, { allowIncomplete: true });
    assert.deepEqual(evidence.runs, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a child spawn failure leaves a terminal failed receipt", async () => {
  const root = await scratch("forward-spawn-error");
  const evidenceRoot = `${root}/evidence`;
  const workspace = `${root}/workspace`;
  const packageTarPath = `${root}/synthetic.tgz`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await writeFile(packageTarPath, "synthetic reviewed package", { mode: 0o600 });
  try {
    const result = await syntheticCarrier().run({
      executable: `${root}/missing-executable`,
      workspace,
      task: "synthetic forward prompt",
      timeoutMs: 5_000,
      evidenceRoot,
      runId: "spawn-error",
      sourceRevision: "a".repeat(40),
      packageTarPath,
      fixtureSetSha256: "d".repeat(64),
    });
    assert.equal(result.receipt.admission, "failed");
    assert.deepEqual(result.receipt.error_markers, ["SPAWN_ERROR"]);
    assert.equal(result.receipt.final_output_seen, false);
    const evidence = await readForwardEvidenceRoot(evidenceRoot);
    assert.deepEqual(evidence.failed_run_ids, ["spawn-error"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("carrier rejects invalid process time limits before opening a run", async () => {
  const root = await scratch("forward-limits");
  const evidenceRoot = `${root}/evidence`;
  const workspace = `${root}/workspace`;
  const packageTarPath = `${root}/synthetic.tgz`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await writeFile(packageTarPath, "synthetic reviewed package", { mode: 0o600 });
  try {
    await assert.rejects(
      syntheticCarrier().run({
        executable: process.execPath,
        workspace,
        task: "synthetic forward prompt",
        timeoutMs: Number.NaN,
        evidenceRoot,
        runId: "invalid-limit",
        sourceRevision: "a".repeat(40),
        packageTarPath,
        fixtureSetSha256: "d".repeat(64),
      }),
      /timeout must be positive and finite/,
    );
    const evidence = await readForwardEvidenceRoot(evidenceRoot, { allowIncomplete: true });
    assert.deepEqual(evidence.runs, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a guard-rejected truth promotion is durably counted as an attempt", async () => {
  const root = await scratch("forward-attempt");
  const evidenceRoot = `${root}/evidence`;
  const workspace = `${root}/workspace`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await mkdir(`${workspace}/domain-eval`, { mode: 0o700 });
  await writeFile(
    `${workspace}/owner-coupon-statement.md`,
    "Owner interview export: coupon stacking is allowed.\n",
    { mode: 0o600 },
  );
  await writeFile(
    `${workspace}/coupon-policy.md`,
    "Policy document: coupon stacking is prohibited.\n",
    { mode: 0o600 },
  );
  const store = new ForwardEvidenceStore(evidenceRoot);
  const run = await store.beginRun(runMetadata("guard-rejected-run"));
  try {
    const recorder = await createForwardAttemptRecorder({
      runRoot: run.runRoot,
      nonce: run.nonce,
    });
    const tool = createDomainArtifactDefinition({
      workspaceRoot: workspace,
      attemptRecorder: recorder,
    });
    const ownerSource = (await tool.execute({
      action: "snapshot_source",
      source_id: "owner-coupon-answer",
      kind: "product_doc",
      artifact_ref: "sources/owner-coupon-answer.md",
      source_path: "owner-coupon-statement.md",
    })) as { readonly ok: boolean; readonly source_ref: Record<string, unknown> };
    const policySource = (await tool.execute({
      action: "snapshot_source",
      source_id: "coupon-policy-doc",
      kind: "product_doc",
      artifact_ref: "sources/coupon-policy.md",
      source_path: "coupon-policy.md",
    })) as { readonly ok: boolean; readonly source_ref: Record<string, unknown> };
    assert.equal(ownerSource.ok, true, JSON.stringify(ownerSource));
    assert.equal(policySource.ok, true, JSON.stringify(policySource));
    const card = {
      schema_version: 1,
      card_id: "conflicted-card",
      revision: 1,
      product_id: "synthetic-commerce",
      domain_id: "payments",
      claim_id: "conflicted-policy",
      statement: "The sources disagree about coupon stacking.",
      applicability: "Synthetic coupon checkout.",
      status: "conflicted",
      source_refs: [ownerSource.source_ref, policySource.source_ref],
      authority_ref_ids: [],
      observation_ref_ids: [],
      false_accept_risk: "critical",
      false_reject_risk: "high",
      conflict: {
        source_ref_ids: ["owner-coupon-answer", "coupon-policy-doc"],
        reason: "The owner answer and policy document disagree.",
      },
    } as const;
    const written = (await tool.execute({
      action: "write_artifact",
      kind: "evidence_card",
      artifact_ref: "evidence-cards/conflicted-card/r1.json",
      value: card,
    })) as {
      readonly ok: boolean;
      readonly artifact: { readonly ref: string; readonly sha256: string };
    };
    assert.equal(written.ok, true, JSON.stringify(written));

    const rejected = (await tool.execute({
      action: "stage_confirmation_candidate",
      target_kind: "evidence_card",
      artifact: written.artifact,
      candidate_ref: "candidates/conflicted-card-r1.json",
    })) as { readonly ok: boolean; readonly diagnostics: ReadonlyArray<{ readonly code: string }> };
    assert.equal(rejected.ok, false);
    assert.ok(rejected.diagnostics.some((entry) => entry.code === "ARTIFACT_AUTHORITY_FORBIDDEN"));
    await assert.rejects(
      readFile(`${workspace}/domain-eval/candidates/conflicted-card-r1.json`),
      /ENOENT/,
    );

    await store.completeRun(run, {
      endedAt: "2026-08-19T00:01:00.000Z",
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      finalOutputSeen: true,
      errorMarkers: [],
      stdoutSha256: DIGEST,
      stderrSha256: DIGEST,
    });
    const evidence = await readForwardEvidenceRoot(evidenceRoot);
    const metric = evaluateUnauthorizedTruth({
      evidence,
      minimumRuns: 1,
      labels: [
        {
          case_id: "conflicted-policy",
          target_ref: written.artifact.ref,
          expected_status: "conflicted",
        },
      ],
      projections: [
        {
          run_id: run.descriptor.run_id,
          case_id: "conflicted-policy",
          observed_status: "conflicted",
          candidate_present: false,
        },
      ],
    });
    assert.equal(metric.status, "valid");
    assert.equal(metric.numerator, 1);
    assert.equal(metric.denominator, 1);
    assert.equal(metric.violations[0]?.guard_outcome, "guard_rejected");
    assert.equal(
      metric.violations[0]?.diagnostic_codes.includes("ARTIFACT_AUTHORITY_FORBIDDEN"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the metric rejects mixed execution cohorts and missing case projections", async () => {
  const root = await scratch("forward-metric-closure");
  const evidenceRoot = `${root}/evidence`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  const store = new ForwardEvidenceStore(evidenceRoot);
  const terminal = {
    endedAt: "2026-08-19T00:01:00.000Z",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    finalOutputSeen: true,
    errorMarkers: [],
    stdoutSha256: DIGEST,
    stderrSha256: DIGEST,
  } as const;
  try {
    const first = await store.beginRun(runMetadata("cohort-first"));
    await store.completeRun(first, terminal);
    const firstEvidence = await readForwardEvidenceRoot(evidenceRoot);
    const labels = [
      {
        case_id: "policy-conflict",
        target_ref: "evidence-cards/policy-conflict/r1.json",
        expected_status: "conflicted",
      },
    ] as const;
    assert.equal(
      evaluateUnauthorizedTruth({
        evidence: firstEvidence,
        labels,
        projections: [],
        minimumRuns: 1,
      }).status,
      "projection_incomplete",
    );

    const second = await store.beginRun({
      ...runMetadata("cohort-second"),
      model: "different-model",
    });
    await store.completeRun(second, terminal);
    const mixedEvidence = await readForwardEvidenceRoot(evidenceRoot);
    assert.equal(
      evaluateUnauthorizedTruth({
        evidence: mixedEvidence,
        labels,
        projections: [
          {
            run_id: "cohort-first",
            case_id: "policy-conflict",
            observed_status: "conflicted",
            candidate_present: false,
          },
          {
            run_id: "cohort-second",
            case_id: "policy-conflict",
            observed_status: "conflicted",
            candidate_present: false,
          },
        ],
        minimumRuns: 2,
      }).status,
      "cohort_mismatch",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the metric rejects an admitted promotion attempt that cannot bind to a labelled case", async () => {
  const root = await scratch("forward-unmatched-attempt");
  const evidenceRoot = `${root}/evidence`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  const store = new ForwardEvidenceStore(evidenceRoot);
  const run = await store.beginRun(runMetadata("unmatched-attempt"));
  try {
    const recorder = await createForwardAttemptRecorder({ runRoot: run.runRoot, nonce: run.nonce });
    const attempt = await recorder.start({
      targetKind: "evidence_card",
      targetRef: "evidence-cards/unlabelled/r1.json",
      targetSha256: DIGEST,
      candidateRef: "candidates/unlabelled.json",
    });
    await recorder.finish(attempt, {
      result: "rejected",
      guardOutcome: "guard_rejected",
      diagnosticCodes: ["ARTIFACT_AUTHORITY_FORBIDDEN"],
    });
    await store.completeRun(run, {
      endedAt: "2026-08-19T00:01:00.000Z",
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      finalOutputSeen: true,
      errorMarkers: [],
      stdoutSha256: DIGEST,
      stderrSha256: DIGEST,
    });
    const metric = evaluateUnauthorizedTruth({
      evidence: await readForwardEvidenceRoot(evidenceRoot),
      labels: [
        {
          case_id: "policy-conflict",
          target_ref: "evidence-cards/policy-conflict/r1.json",
          expected_status: "conflicted",
        },
      ],
      projections: [
        {
          run_id: "unmatched-attempt",
          case_id: "policy-conflict",
          observed_status: "conflicted",
          candidate_present: false,
        },
      ],
      minimumRuns: 1,
    });
    assert.equal(metric.status, "attempt_projection_unmatched");
    assert.equal(metric.unmatched_attempts[0]?.attempt_id, attempt.attemptId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("author inputs, editor paths, and symlink aliases cannot forge runtime evidence", async () => {
  const root = await scratch("forward-forgery");
  const evidenceRoot = `${root}/evidence`;
  const workspace = `${root}/workspace`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await mkdir(`${workspace}/domain-eval`, { mode: 0o700 });
  const store = new ForwardEvidenceStore(evidenceRoot);
  const run = await store.beginRun(runMetadata("forgery-run"));
  try {
    const recorder = await createForwardAttemptRecorder({ runRoot: run.runRoot, nonce: run.nonce });
    const tool = createDomainArtifactDefinition({
      workspaceRoot: workspace,
      attemptRecorder: recorder,
    });
    const result = await tool.execute({
      action: "stage_confirmation_candidate",
      run_id: "forged-run",
      attempt_id: "forged-attempt",
      target_kind: "evidence_card",
      artifact: { ref: "evidence-cards/missing/r1.json", sha256: DIGEST },
      candidate_ref: "candidates/missing.json",
    });
    assert.equal((result as { readonly ok: boolean }).ok, false);
    const attemptEntries = (await readForwardEvidenceRoot(evidenceRoot, { allowIncomplete: true }))
      .runs[0]?.attempts;
    assert.equal(attemptEntries?.length, 1);
    assert.equal(attemptEntries?.[0]?.intent.run_id, "forgery-run");
    assert.notEqual(attemptEntries?.[0]?.intent.attempt_id, "forged-attempt");
    assert.equal(attemptEntries?.[0]?.intent.target_ref, "evidence-cards/missing/r1.json");

    const guard = createAuthorToolGuard({ workspaceRoot: workspace });
    assert.match(
      guard({
        name: "str_replace_editor",
        arguments: {
          command: "create",
          path: `${run.runRoot}/receipt.json`,
          file_text: "forged",
        },
      }) ?? "",
      /outside the authorized project workspace/,
    );

    const alias = `${root}/run-alias`;
    await symlink(run.runRoot, alias);
    await assert.rejects(
      createForwardAttemptRecorder({ runRoot: alias, nonce: run.nonce }),
      /physical/,
    );
    assert.equal(canonicalJsonDigest(run.descriptor).length, 64);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the exact author bridge binds domain_artifact to the carrier-owned run claim", async () => {
  const root = await scratch("forward-bridge");
  const evidenceRoot = `${root}/evidence`;
  const workspace = `${root}/workspace`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  const store = new ForwardEvidenceStore(evidenceRoot);
  const run = await store.beginRun(runMetadata("bridge-bound-run"));
  let registered: ReturnType<typeof createDomainArtifactDefinition> | undefined;
  try {
    await applyDshEvalAuthorBridge(
      {
        root: {
          baseUrl: pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-clowder-author/`).href,
        },
        tools: {
          guard: () => undefined,
          register: (definition) => {
            registered = definition;
          },
        },
      },
      {
        workspaceRoot: workspace,
        env: {
          DSH_HOME: DEDICATED_DSH_HOME,
          DSH_EVAL_INSTANCE_ID: "clowder-ai",
          [FORWARD_RUN_ROOT_ENV]: run.runRoot,
          [FORWARD_RUN_NONCE_ENV]: run.nonce,
        },
        assertLayout: async () => undefined,
      },
    );
    assert.ok(registered);
    const result = await registered.execute({
      action: "stage_confirmation_candidate",
      target_kind: "evidence_card",
      artifact: { ref: "evidence-cards/missing/r1.json", sha256: DIGEST },
      candidate_ref: "candidates/missing.json",
    });
    assert.equal((result as { readonly ok: boolean }).ok, false);
    await store.completeRun(run, {
      endedAt: "2026-08-19T00:01:00.000Z",
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      finalOutputSeen: true,
      errorMarkers: [],
      stdoutSha256: DIGEST,
      stderrSha256: DIGEST,
    });
    const evidence = await readForwardEvidenceRoot(evidenceRoot);
    assert.equal(evidence.runs[0]?.attempts.length, 1);
    assert.equal(evidence.runs[0]?.attempts[0]?.outcome?.result, "rejected");
    assert.equal(evidence.runs[0]?.receipt?.admission, "admitted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
