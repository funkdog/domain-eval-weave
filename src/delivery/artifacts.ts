import {
  type ArtifactPointer,
  parseArtifactRef,
  readJsonArtifact,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { parsePairedEvaluationArtifact, parsePairedImpactReport } from "../contracts/parsers.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import {
  type DeliveryEvaluationReport,
  parseClaimIr,
  parseDeliveryEvaluationReport,
  parseGraderAdmission,
  parseOraclePlan,
} from "./contracts.js";
import { buildDeliveryEvaluationReport } from "./report.js";

const CLAIM_IR_REF = "artifact://campaign/delivery/claim-ir.json";
const ORACLE_PLAN_REF = "artifact://campaign/delivery/oracle-plan.json";
const ADMISSION_REF = "artifact://campaign/delivery/grader-admission.json";
const DELIVERY_REPORT_REF = "artifact://campaign/delivery/report.json";
const DELIVERY_MARKDOWN_REF = "artifact://campaign/delivery/report.md";

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
  readonly admission: unknown;
  readonly pairedEvaluation: unknown;
  readonly pairedReport: unknown;
  readonly pairedEvaluationPointer: { readonly ref: string; readonly sha256: string };
  readonly pairedReportPointer: { readonly ref: string; readonly sha256: string };
}): Promise<{
  readonly report: DeliveryEvaluationReport;
  readonly claimIrPointer: ArtifactPointer;
  readonly oraclePlanPointer: ArtifactPointer;
  readonly admissionPointer: ArtifactPointer;
  readonly reportPointer: ArtifactPointer;
  readonly markdownPointer: ArtifactPointer;
}> {
  const claimIr = parseClaimIr(input.claimIr);
  const oraclePlan = parseOraclePlan(input.oraclePlan);
  const admission = parseGraderAdmission(input.admission);
  for (const value of [claimIr, oraclePlan, admission]) {
    assertSecretFreeText(canonicalJson(value));
  }
  const [claimIrPointer, oraclePlanPointer, admissionPointer] = await Promise.all([
    writeCanonicalJsonArtifact(input.campaignRoot, CLAIM_IR_REF, claimIr),
    writeCanonicalJsonArtifact(input.campaignRoot, ORACLE_PLAN_REF, oraclePlan),
    writeCanonicalJsonArtifact(input.campaignRoot, ADMISSION_REF, admission),
  ]);
  if (
    oraclePlan.claim_ir_sha256 !== claimIrPointer.sha256 ||
    admission.oracle_plan_sha256 !== oraclePlanPointer.sha256
  ) {
    throw new Error("persisted Phase 3B compilation closure drifted");
  }
  const report = buildDeliveryEvaluationReport({
    evaluationId: input.evaluationId,
    claimIr,
    oraclePlan,
    admission,
    pairedEvaluation: input.pairedEvaluation,
    pairedReport: input.pairedReport,
    pairedEvaluationPointer: input.pairedEvaluationPointer,
    pairedReportPointer: input.pairedReportPointer,
  });
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
  const [claimIr, oraclePlan, admission, pairedEvaluation, pairedReport] = await Promise.all([
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
    readJsonArtifact(
      input.campaignRoot,
      report.source.paired_evaluation,
      parsePairedEvaluationArtifact,
    ),
    readJsonArtifact(input.campaignRoot, report.source.paired_report, parsePairedImpactReport),
  ]);
  const rebuilt = buildDeliveryEvaluationReport({
    evaluationId: report.evaluation_id,
    claimIr,
    oraclePlan,
    admission,
    pairedEvaluation,
    pairedReport,
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
