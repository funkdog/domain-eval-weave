import type { ArtifactPointer } from "../contracts/artifacts.js";
import {
  parseArtifactRef,
  readJsonArtifact,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import { parseCommerceObservationCatalog } from "./catalog.js";
import { replayCommerceOraclePlan } from "./compiler.js";
import {
  type CommerceDeliveryReport,
  parseCommerceClaimIr,
  parseCommerceDeliveryReport,
  parseCommerceGraderAdmission,
  parseCommerceOraclePlan,
} from "./delivery-contracts.js";
import { buildCommerceDeliveryReport } from "./delivery-report.js";
import { replayCommerceCampaign } from "./replay.js";

const CATALOG_REF = "artifact://campaign/delivery/observation-catalog.json";
const CLAIM_IR_REF = "artifact://campaign/delivery/claim-ir.json";
const PLAN_REF = "artifact://campaign/delivery/oracle-plan.json";
const ADMISSION_REF = "artifact://campaign/delivery/grader-admission.json";
const REPORT_REF = "artifact://campaign/delivery/report.json";
const MARKDOWN_REF = "artifact://campaign/delivery/report.md";

function pointer(value: { readonly ref: string; readonly sha256: string }): ArtifactPointer {
  return { ref: parseArtifactRef(value.ref), sha256: value.sha256 };
}

function samePointer(
  left: { readonly ref: string; readonly sha256: string },
  right: { readonly ref: string; readonly sha256: string },
) {
  return left.ref === right.ref && left.sha256 === right.sha256;
}

async function boundCampaign(input: {
  readonly campaignRoot: string;
  readonly claimIr: ReturnType<typeof parseCommerceClaimIr>;
  readonly plan: ReturnType<typeof parseCommerceOraclePlan>;
  readonly admission: ReturnType<typeof parseCommerceGraderAdmission>;
  readonly catalog: ReturnType<typeof parseCommerceObservationCatalog>;
  readonly pairedReportPointer: { readonly ref: string; readonly sha256: string };
}) {
  const replayed = await replayCommerceCampaign(
    input.campaignRoot,
    pointer(input.pairedReportPointer),
  );
  const taskPackDigest = canonicalJsonDigest(replayed.taskPack);
  const catalogDigest = canonicalJsonDigest(input.catalog);
  if (
    replayed.taskPack.schema_version !== 2 ||
    replayed.taskPack.template_id !== "commerce-order-cancellation-v2" ||
    input.claimIr.source.task_pack_sha256 !== taskPackDigest ||
    input.plan.task_pack_sha256 !== taskPackDigest ||
    input.admission.task_pack_sha256 !== taskPackDigest ||
    replayed.experiment.task_pack_digest !== taskPackDigest ||
    replayed.taskPack.observation_catalog_sha256 !== catalogDigest ||
    input.claimIr.source.observation_catalog_sha256 !== catalogDigest ||
    input.plan.observation_catalog_sha256 !== catalogDigest ||
    input.admission.observation_catalog_sha256 !== catalogDigest ||
    input.plan.oracle_version !== replayed.taskPack.pack.oracle_version ||
    input.admission.eval_package_sha256 !== replayed.experiment.deployment.eval_package_sha256 ||
    canonicalJsonDigest(input.admission) !== replayed.experiment.deployment.grader_admission_sha256
  ) {
    throw new Error("Commerce Admission does not bind the replayed Campaign deployment");
  }
  return replayed;
}

export function renderCommerceDeliveryReport(report: CommerceDeliveryReport): string {
  return [
    `# Commerce Delivery Evaluation ${report.evaluation_id}`,
    "",
    `Verdict: **${report.verdict}**`,
    "",
    "| Axis | Status |",
    "| --- | --- |",
    `| Requirement Delta | ${report.axes.requirement_delta.status} |`,
    `| Domain Preservation | ${report.axes.domain_preservation.status} |`,
    `| Semantic Residual | ${report.axes.semantic_residual.status} |`,
    `| Measurement Validity | ${report.axes.measurement_validity.status} |`,
    `| Harness Impact | ${report.axes.harness_impact.status} |`,
    "",
    "No cross-axis aggregate score is defined.",
    "",
  ].join("\n");
}

export async function persistCommerceDelivery(input: {
  readonly campaignRoot: string;
  readonly evaluationId: string;
  readonly claimIr: unknown;
  readonly oraclePlan: unknown;
  readonly catalog: unknown;
  readonly admission: unknown;
  readonly pairedReportPointer: { readonly ref: string; readonly sha256: string };
}) {
  const claimIr = parseCommerceClaimIr(input.claimIr);
  const catalog = parseCommerceObservationCatalog(input.catalog);
  const plan = replayCommerceOraclePlan({ claimIr, oraclePlan: input.oraclePlan, catalog });
  const admission = parseCommerceGraderAdmission(input.admission);
  const replayed = await boundCampaign({
    campaignRoot: input.campaignRoot,
    claimIr,
    plan,
    admission,
    catalog,
    pairedReportPointer: input.pairedReportPointer,
  });
  const report = buildCommerceDeliveryReport({
    evaluationId: input.evaluationId,
    claimIr,
    oraclePlan: plan,
    catalog,
    admission,
    pairedEvaluation: replayed.evaluation,
    pairedReport: replayed.report,
    pairedEvaluationPointer: replayed.report.evidence.evaluation,
    pairedReportPointer: input.pairedReportPointer,
  });
  parseCommerceDeliveryReport(JSON.parse(canonicalJson(report)));
  for (const value of [catalog, claimIr, plan, admission, report]) {
    assertSecretFreeText(canonicalJson(value));
  }
  const [catalogPointer, claimPointer, planPointer, admissionPointer] = await Promise.all([
    writeCanonicalJsonArtifact(input.campaignRoot, CATALOG_REF, catalog),
    writeCanonicalJsonArtifact(input.campaignRoot, CLAIM_IR_REF, claimIr),
    writeCanonicalJsonArtifact(input.campaignRoot, PLAN_REF, plan),
    writeCanonicalJsonArtifact(input.campaignRoot, ADMISSION_REF, admission),
  ]);
  if (
    plan.observation_catalog_sha256 !== catalogPointer.sha256 ||
    plan.claim_ir_sha256 !== claimPointer.sha256 ||
    admission.oracle_plan_sha256 !== planPointer.sha256 ||
    report.source.grader_admission_sha256 !== admissionPointer.sha256
  ) {
    throw new Error("Commerce persisted compilation closure drifted");
  }
  const markdown = renderCommerceDeliveryReport(report);
  assertSecretFreeText(markdown);
  const [reportPointer, markdownPointer] = await Promise.all([
    writeCanonicalJsonArtifact(input.campaignRoot, REPORT_REF, report),
    writeArtifactBytes(input.campaignRoot, MARKDOWN_REF, markdown),
  ]);
  await replayCommerceDelivery({ campaignRoot: input.campaignRoot, reportPointer });
  return {
    report,
    catalogPointer,
    claimPointer,
    planPointer,
    admissionPointer,
    reportPointer,
    markdownPointer,
  };
}

export async function replayCommerceDelivery(input: {
  readonly campaignRoot: string;
  readonly reportPointer: { readonly ref: string; readonly sha256: string };
}) {
  if (input.reportPointer.ref !== REPORT_REF) {
    throw new Error("Commerce Delivery replay requires the frozen report ref");
  }
  const report = await readJsonArtifact(
    input.campaignRoot,
    pointer(input.reportPointer),
    parseCommerceDeliveryReport,
  );
  const [claimIr, plan, admission] = await Promise.all([
    readJsonArtifact(
      input.campaignRoot,
      pointer({ ref: CLAIM_IR_REF, sha256: report.source.claim_ir_sha256 }),
      parseCommerceClaimIr,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer({ ref: PLAN_REF, sha256: report.source.oracle_plan_sha256 }),
      parseCommerceOraclePlan,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer({ ref: ADMISSION_REF, sha256: report.source.grader_admission_sha256 }),
      parseCommerceGraderAdmission,
    ),
  ]);
  const catalog = await readJsonArtifact(
    input.campaignRoot,
    pointer({ ref: CATALOG_REF, sha256: plan.observation_catalog_sha256 }),
    parseCommerceObservationCatalog,
  );
  replayCommerceOraclePlan({ claimIr, oraclePlan: plan, catalog });
  const replayed = await boundCampaign({
    campaignRoot: input.campaignRoot,
    claimIr,
    plan,
    admission,
    catalog,
    pairedReportPointer: report.source.paired_report,
  });
  if (!samePointer(report.source.paired_evaluation, replayed.report.evidence.evaluation)) {
    throw new Error("Commerce Delivery evaluation pointer drifted from Campaign replay");
  }
  const rebuilt = buildCommerceDeliveryReport({
    evaluationId: report.evaluation_id,
    claimIr,
    oraclePlan: plan,
    catalog,
    admission,
    pairedEvaluation: replayed.evaluation,
    pairedReport: replayed.report,
    pairedEvaluationPointer: report.source.paired_evaluation,
    pairedReportPointer: report.source.paired_report,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(report)) {
    throw new Error("Commerce Delivery report cannot be deterministically replayed");
  }
  return {
    report,
    reportPointer: {
      ref: parseArtifactRef(input.reportPointer.ref),
      sha256: canonicalJsonDigest(report),
    },
  };
}
