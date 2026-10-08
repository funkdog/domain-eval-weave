import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../canonical-json.js";
import { writeExclusiveOrVerify } from "../capsule/artifact-store.js";
import { compileDomainLandscapeDirectory } from "../domain/compiler.js";

// Internal, five-case development projection. Not a public Domain View/Product Contract compiler.
const example = new URL("../../examples/payment-recovery-eval/", import.meta.url);
const domain = new URL("../../examples/killbill-orchestration/", import.meta.url);
const text = z.string().min(1);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const originalRequest = z.strictObject({
  idempotency_key: text,
  request_fingerprint: text,
  context_ref: text,
});
const taskSchema = z.strictObject({
  task_id: text,
  purpose: text,
  policy: text,
  actions: z.record(text, text),
  cases: z
    .array(
      z.strictObject({
        case_id: text,
        operation_ref: text,
        context_ref: text,
        description: text,
        evidence: z.record(text, text),
        original_request: originalRequest.nullable(),
      }),
    )
    .min(1),
});
const rubricSchema = z.strictObject({
  evaluation_id: text,
  domain_pin: z.strictObject({
    module_id: text,
    version: text,
    compiled_content_sha256: sha,
    behavioral_document_sha256: sha,
  }),
  claim_ids: z.array(text).min(1),
  policy_selection: text,
  metric_birth_certificate: z.record(text, z.json()),
  cases: z
    .array(
      z.strictObject({
        case_id: text,
        safe_actions: z.array(text).min(1),
        progress_actions: z.array(text).min(1),
        required_evidence: z.array(text).min(1),
        basis: text,
      }),
    )
    .min(1),
});
const submissionSchema = z.strictObject({
  candidate_id: text,
  origin: z.enum(["authored_example", "imported_unattested_capture"]),
  task_sha256: sha,
  decisions: z.array(z.record(z.string(), z.unknown())),
});
const decisionSchema = z.strictObject({
  case_id: text,
  operation_ref: text,
  context_ref: text,
  // Unknown action names remain observed choices; they do not bypass grading as a schema error.
  action: text,
  evidence_refs: z.array(text),
  reason: text,
  replay: originalRequest.optional(),
});
const outcomeSchema = z.enum([
  "pass",
  "fail",
  "not_applicable",
  "insufficient_evidence",
  "indeterminate",
]);
const atomsSchema = z.strictObject({
  action_safety: outcomeSchema,
  identity_binding: outcomeSchema,
  evidence_binding: outcomeSchema,
  decision_progress: outcomeSchema,
  replay_fidelity: outcomeSchema,
});
const resultSchema = z.strictObject({
  decision_verdict: z.enum([
    "retain_for_development",
    "revise_decision_artifact",
    "collect_more_evidence",
  ]),
  qualification: z.literal("not_qualified"),
  stage: z.literal("development_only"),
  episodes: z
    .array(
      z.strictObject({
        case_id: text,
        atoms: atomsSchema,
        decision_outcome: outcomeSchema,
        financial_effect: z.literal("indeterminate"),
        basis: text,
        diagnostic: text,
      }),
    )
    .min(1),
});

type Outcome = z.infer<typeof outcomeSchema>;
type Atoms = z.infer<typeof atomsSchema>;

function uniqueIds(ids: readonly string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${label}`);
}

export async function freezeRecoveryEvaluation() {
  const task = taskSchema.parse(JSON.parse(await readFile(new URL("task.json", example), "utf8")));
  const rubric = rubricSchema.parse(
    JSON.parse(await readFile(new URL("rubric.json", example), "utf8")),
  );
  uniqueIds(
    task.cases.map((item) => item.case_id),
    "task case",
  );
  uniqueIds(
    rubric.cases.map((item) => item.case_id),
    "rubric case",
  );
  uniqueIds(rubric.claim_ids, "claim");
  if (
    canonicalJsonDigest(task.cases.map((item) => item.case_id).sort()) !==
    canonicalJsonDigest(rubric.cases.map((item) => item.case_id).sort())
  ) {
    throw new Error("task/rubric case coverage mismatch");
  }
  for (const rule of rubric.cases) {
    const item = task.cases.find((candidate) => candidate.case_id === rule.case_id);
    if (
      !item ||
      rule.required_evidence.some((id) => !(id in item.evidence)) ||
      rule.safe_actions.some((action) => !(action in task.actions)) ||
      rule.progress_actions.some((action) => !rule.safe_actions.includes(action))
    ) {
      throw new Error(`rubric reference mismatch: ${rule.case_id}`);
    }
  }
  const compiled = await compileDomainLandscapeDirectory(fileURLToPath(domain));
  const module = compiled.modules[0];
  if (
    compiled.modules.length !== 1 ||
    module?.moduleId !== rubric.domain_pin.module_id ||
    module.version !== rubric.domain_pin.version ||
    canonicalJsonDigest(compiled) !== rubric.domain_pin.compiled_content_sha256
  ) {
    throw new Error("domain pin mismatch; re-evaluate applicability before repinning");
  }
  const behavioral = module.modelDocuments?.find(
    (document) => document.contentSha256 === rubric.domain_pin.behavioral_document_sha256,
  );
  if (!behavioral) throw new Error("behavioral document pin mismatch");
  const selectedClaims = rubric.claim_ids.map((id) => {
    const claim = compiled.claims.find(
      (candidate) => candidate.claimRef === `${module.moduleId}#${id}`,
    );
    if (claim?.epistemicState !== "grounded") throw new Error(`domain claim changed: ${id}`);
    return claim;
  });
  const implementation = Object.fromEntries(
    await Promise.all(
      [
        ["grader", new URL("recovery-decision.ts", import.meta.url)],
        ["canonical-json", new URL("../canonical-json.ts", import.meta.url)],
        ["artifact-store", new URL("../capsule/artifact-store.ts", import.meta.url)],
      ].map(async ([name, url]) => [String(name), sha256Hex(await readFile(url as URL))]),
    ),
  );
  return {
    format: "recovery-decision-development-closure-v0" as const,
    task,
    rubric,
    selected_claims: selectedClaims,
    domain_sources: compiled.sourceSnapshots.filter((source) =>
      selectedClaims.some((claim) => claim.sourceIds.includes(source.sourceId)),
    ),
    behavioral_document: behavioral,
    implementation,
  };
}

type Closure = Awaited<ReturnType<typeof freezeRecoveryEvaluation>>;

function filledAtoms(outcome: Outcome): Atoms {
  return {
    action_safety: outcome,
    identity_binding: outcome,
    evidence_binding: outcome,
    decision_progress: outcome,
    replay_fidelity: outcome,
  };
}

function combine(atoms: Atoms): Outcome {
  const values = Object.values(atoms);
  return (
    (["fail", "indeterminate", "insufficient_evidence", "pass", "not_applicable"] as const).find(
      (value) => values.includes(value),
    ) ?? "indeterminate"
  );
}

export function gradeRecoveryDecisions(closure: Closure, input: unknown) {
  const submission = submissionSchema.parse(input);
  if (submission.task_sha256 !== canonicalJsonDigest(closure.task)) {
    throw new Error("candidate task digest mismatch");
  }
  const ids = submission.decisions.map((decision) => text.parse(decision.case_id));
  uniqueIds(ids, "candidate case");
  if (ids.some((id) => !closure.task.cases.some((item) => item.case_id === id))) {
    throw new Error("candidate case not in this task");
  }
  const episodes = closure.task.cases.map((item) => {
    const rule = closure.rubric.cases.find((candidate) => candidate.case_id === item.case_id);
    if (!rule) throw new Error("missing frozen rubric case");
    const raw = submission.decisions.find((decision) => decision.case_id === item.case_id);
    let atoms = filledAtoms("insufficient_evidence");
    let diagnostic = "未收到此 Episode 的决策；没有完整沉默观测契约，不判行为失败。";
    if (raw !== undefined) {
      const parsed = decisionSchema.safeParse(raw);
      if (!parsed.success) {
        atoms = filledAtoms("indeterminate");
        diagnostic = "决策不满足结构化观测协议；需修复捕获/适配，不猜测行为。";
      } else {
        const decision = parsed.data;
        const replaying = decision.action === "REPLAY_ORIGINAL_REQUEST";
        const replayFidelity: Outcome = replaying
          ? item.original_request !== null &&
            decision.replay !== undefined &&
            canonicalJsonDigest(decision.replay) === canonicalJsonDigest(item.original_request)
            ? "pass"
            : "fail"
          : decision.replay === undefined
            ? "not_applicable"
            : "fail";
        atoms = {
          action_safety:
            rule.safe_actions.includes(decision.action) && replayFidelity !== "fail"
              ? "pass"
              : "fail",
          identity_binding:
            decision.operation_ref === item.operation_ref &&
            decision.context_ref === item.context_ref
              ? "pass"
              : "fail",
          evidence_binding:
            rule.required_evidence.every((id) => decision.evidence_refs.includes(id)) &&
            decision.evidence_refs.every((id) => Object.hasOwn(item.evidence, id))
              ? "pass"
              : "fail",
          decision_progress: rule.progress_actions.includes(decision.action) ? "pass" : "fail",
          replay_fidelity: replayFidelity,
        };
        diagnostic = `观察到 ${decision.action}；只判结构化选择、引用和原请求一致性，不评价 reason 的自然语言质量。`;
      }
    }
    return {
      case_id: item.case_id,
      atoms,
      decision_outcome: combine(atoms),
      financial_effect: "indeterminate" as const,
      basis: rule.basis,
      diagnostic,
    };
  });
  const result = resultSchema.parse({
    decision_verdict: episodes.some((episode) => episode.decision_outcome === "fail")
      ? "revise_decision_artifact"
      : episodes.every((episode) => episode.decision_outcome === "pass")
        ? "retain_for_development"
        : "collect_more_evidence",
    qualification: "not_qualified",
    stage: "development_only",
    episodes,
  });
  const body = { format: "recovery-decision-run-v0" as const, closure, submission, result };
  return { ...body, run_digest: canonicalJsonDigest(body) };
}

type Artifact = ReturnType<typeof gradeRecoveryDecisions>;

// Artifact-only integrity replay: no Candidate execution, compilation or re-grading with current code.
// A content address proves integrity, not authorship or external observation authenticity.
export function replayRecoveryArtifact(input: unknown) {
  const artifact = z
    .strictObject({
      format: z.literal("recovery-decision-run-v0"),
      closure: z.json(),
      submission: z.json(),
      result: resultSchema,
      run_digest: sha,
    })
    .parse(input);
  const { run_digest: digest, ...body } = artifact;
  if (canonicalJsonDigest(body) !== digest) throw new Error("run digest mismatch");
  return artifact.result;
}

export async function persistRecoveryArtifact(artifact: Artifact, outputRoot: string) {
  replayRecoveryArtifact(artifact);
  const root = await realpath(outputRoot);
  const runtime = await realpath("/Users/slipshod/AIBuild/dsh-eval-lab-runtime");
  const pathFromRuntime = relative(runtime, root);
  if (
    pathFromRuntime.startsWith("..") ||
    resolve(runtime, pathFromRuntime) !== root ||
    !(await lstat(root)).isDirectory()
  )
    throw new Error("output must be under isolated runtime");
  const path = join(root, `${artifact.run_digest}.json`);
  await writeExclusiveOrVerify(
    path,
    Buffer.from(`${canonicalJson(artifact)}\n`),
    () => new Error("immutable run collision"),
  );
  return path;
}
