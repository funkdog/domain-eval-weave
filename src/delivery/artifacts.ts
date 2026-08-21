import {
  type ArtifactPointer,
  parseArtifactRef,
  readJsonArtifact,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { replayPairedImpactReport } from "../contracts/replay.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import { replayOraclePlanSemantics } from "./compiler.js";
import {
  type DeliveryEvaluationReport,
  parseClaimIr,
  parseDeliveryEvaluationReport,
  parseGraderAdmission,
  parseObservationCatalog,
  parseOraclePlan,
} from "./contracts.js";
import { buildDeliveryEvaluationReport } from "./report.js";

const OBSERVATION_CATALOG_REF = "artifact://campaign/delivery/observation-catalog.json";
const CLAIM_IR_REF = "artifact://campaign/delivery/claim-ir.json";
const ORACLE_PLAN_REF = "artifact://campaign/delivery/oracle-plan.json";
const ADMISSION_REF = "artifact://campaign/delivery/grader-admission.json";
const DELIVERY_REPORT_REF = "artifact://campaign/delivery/report.json";
const DELIVERY_MARKDOWN_REF = "artifact://campaign/delivery/report.md";

function samePointer(
  left: { readonly ref: string; readonly sha256: string },
  right: { readonly ref: string; readonly sha256: string },
): boolean {
  return left.ref === right.ref && left.sha256 === right.sha256;
}

async function replayBoundCampaign(input: {
  readonly campaignRoot: string;
  readonly claimIr: ReturnType<typeof parseClaimIr>;
  readonly oraclePlan: ReturnType<typeof parseOraclePlan>;
  readonly admission: ReturnType<typeof parseGraderAdmission>;
  readonly catalog: ReturnType<typeof parseObservationCatalog>;
  readonly pairedReportPointer: { readonly ref: string; readonly sha256: string };
}) {
  const replayed = await replayPairedImpactReport(input.campaignRoot, {
    ref: parseArtifactRef(input.pairedReportPointer.ref),
    sha256: input.pairedReportPointer.sha256,
  });
  const taskPackDigest = canonicalJsonDigest(replayed.task_pack);
  const catalogDigest = canonicalJsonDigest(input.catalog);
  if (
    input.claimIr.source.task_pack_sha256 !== taskPackDigest ||
    input.oraclePlan.task_pack_sha256 !== taskPackDigest ||
    input.admission.task_pack_sha256 !== taskPackDigest ||
    replayed.experiment.task_pack_digest !== taskPackDigest ||
    replayed.task_pack.observation_catalog_sha256 !== catalogDigest ||
    input.claimIr.source.observation_catalog_sha256 !== catalogDigest ||
    input.oraclePlan.observation_catalog_sha256 !== catalogDigest ||
    input.admission.observation_catalog_sha256 !== catalogDigest ||
    input.oraclePlan.oracle_version !== replayed.task_pack.pack.oracle_version ||
    input.admission.calibration.seed !== replayed.oracle_seed.seed ||
    input.admission.eval_package_sha256 !== replayed.experiment.deployment.eval_package_sha256
  ) {
    throw new Error(
      "Grader Admission does not bind the replayed Campaign deployment, Task Pack, and catalog",
    );
  }
  return replayed;
}

export function renderDeliveryEvaluationMarkdown(report: DeliveryEvaluationReport): string {
  const lines = [
    `# Delivery Evaluation ${report.evaluation_id}`,
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
  ];
  return lines.join("\n");
}

export async function persistDeliveryEvaluation(input: {
  readonly campaignRoot: string;
  readonly evaluationId: string;
  readonly claimIr: unknown;
  readonly oraclePlan: unknown;
  readonly catalog: unknown;
  readonly admission: unknown;
  readonly pairedReportPointer: { readonly ref: string; readonly sha256: string };
}): Promise<{
  readonly report: DeliveryEvaluationReport;
  readonly catalogPointer: ArtifactPointer;
  readonly claimIrPointer: ArtifactPointer;
  readonly oraclePlanPointer: ArtifactPointer;
  readonly admissionPointer: ArtifactPointer;
  readonly reportPointer: ArtifactPointer;
  readonly markdownPointer: ArtifactPointer;
}> {
  const claimIr = parseClaimIr(input.claimIr);
  const catalog = parseObservationCatalog(input.catalog);
  const oraclePlan = replayOraclePlanSemantics({
    claimIr,
    oraclePlan: input.oraclePlan,
    catalog,
  });
  const admission = parseGraderAdmission(input.admission);
  const replayed = await replayBoundCampaign({
    campaignRoot: input.campaignRoot,
    claimIr,
    oraclePlan,
    admission,
    catalog,
    pairedReportPointer: input.pairedReportPointer,
  });
  const report = buildDeliveryEvaluationReport({
    evaluationId: input.evaluationId,
    claimIr,
    oraclePlan,
    catalog,
    admission,
    pairedEvaluation: replayed.evaluation,
    pairedReport: replayed.report,
    pairedEvaluationPointer: replayed.report.evidence.evaluation,
    pairedReportPointer: input.pairedReportPointer,
  });
  for (const value of [catalog, claimIr, oraclePlan, admission, report]) {
    assertSecretFreeText(canonicalJson(value));
  }
  const [catalogPointer, claimIrPointer, oraclePlanPointer, admissionPointer] = await Promise.all([
    writeCanonicalJsonArtifact(input.campaignRoot, OBSERVATION_CATALOG_REF, catalog),
    writeCanonicalJsonArtifact(input.campaignRoot, CLAIM_IR_REF, claimIr),
    writeCanonicalJsonArtifact(input.campaignRoot, ORACLE_PLAN_REF, oraclePlan),
    writeCanonicalJsonArtifact(input.campaignRoot, ADMISSION_REF, admission),
  ]);
  if (
    oraclePlan.observation_catalog_sha256 !== catalogPointer.sha256 ||
    oraclePlan.claim_ir_sha256 !== claimIrPointer.sha256 ||
    admission.oracle_plan_sha256 !== oraclePlanPointer.sha256
  ) {
    throw new Error("persisted Phase 3B compilation closure drifted");
  }
  if (
    report.source.claim_ir_sha256 !== claimIrPointer.sha256 ||
    report.source.oracle_plan_sha256 !== oraclePlanPointer.sha256 ||
    report.source.grader_admission_sha256 !== admissionPointer.sha256
  ) {
    throw new Error("Delivery report does not bind persisted compilation and admission artifacts");
  }
  const markdown = renderDeliveryEvaluationMarkdown(report);
  assertSecretFreeText(canonicalJson(report));
  assertSecretFreeText(markdown);
  const [reportPointer, markdownPointer] = await Promise.all([
    writeCanonicalJsonArtifact(input.campaignRoot, DELIVERY_REPORT_REF, report),
    writeArtifactBytes(input.campaignRoot, DELIVERY_MARKDOWN_REF, markdown),
  ]);
  await replayDeliveryEvaluation({ campaignRoot: input.campaignRoot, reportPointer });
  return {
    report,
    catalogPointer,
    claimIrPointer,
    oraclePlanPointer,
    admissionPointer,
    reportPointer,
    markdownPointer,
  };
}

export async function replayDeliveryEvaluation(input: {
  readonly campaignRoot: string;
  readonly reportPointer: { readonly ref: string; readonly sha256: string };
}): Promise<{
  readonly report: DeliveryEvaluationReport;
  readonly reportPointer: ArtifactPointer;
}> {
  if (input.reportPointer.ref !== DELIVERY_REPORT_REF) {
    throw new Error("Delivery report replay requires the frozen delivery report ref");
  }
  const report = await readJsonArtifact(
    input.campaignRoot,
    input.reportPointer,
    parseDeliveryEvaluationReport,
  );
  const [claimIr, oraclePlan, admission] = await Promise.all([
    readJsonArtifact(
      input.campaignRoot,
      { ref: CLAIM_IR_REF, sha256: report.source.claim_ir_sha256 },
      parseClaimIr,
    ),
    readJsonArtifact(
      input.campaignRoot,
      { ref: ORACLE_PLAN_REF, sha256: report.source.oracle_plan_sha256 },
      parseOraclePlan,
    ),
    readJsonArtifact(
      input.campaignRoot,
      { ref: ADMISSION_REF, sha256: report.source.grader_admission_sha256 },
      parseGraderAdmission,
    ),
  ]);
  const catalog = await readJsonArtifact(
    input.campaignRoot,
    { ref: OBSERVATION_CATALOG_REF, sha256: oraclePlan.observation_catalog_sha256 },
    parseObservationCatalog,
  );
  replayOraclePlanSemantics({ claimIr, oraclePlan, catalog });
  const replayed = await replayBoundCampaign({
    campaignRoot: input.campaignRoot,
    claimIr,
    oraclePlan,
    admission,
    catalog,
    pairedReportPointer: report.source.paired_report,
  });
  if (!samePointer(report.source.paired_evaluation, replayed.report.evidence.evaluation)) {
    throw new Error("Delivery report evaluation pointer drifted from full Campaign replay");
  }
  const rebuilt = buildDeliveryEvaluationReport({
    evaluationId: report.evaluation_id,
    claimIr,
    oraclePlan,
    catalog,
    admission,
    pairedEvaluation: replayed.evaluation,
    pairedReport: replayed.report,
    pairedEvaluationPointer: report.source.paired_evaluation,
    pairedReportPointer: report.source.paired_report,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(report)) {
    throw new Error("persisted Delivery Evaluation Report cannot be deterministically replayed");
  }
  return {
    report,
    reportPointer: {
      ref: parseArtifactRef(input.reportPointer.ref),
      sha256: canonicalJsonDigest(report),
    },
  };
}
