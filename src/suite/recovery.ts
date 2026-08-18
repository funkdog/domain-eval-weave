import { canonicalJson } from "../contracts/canonical-json.js";
import {
  parseSuiteInvalidEnvelope,
  type SuiteInvalidEnvelope,
  type SuiteReport,
} from "../contracts/phase2.js";
import {
  readSuiteArtifactBytesByRef,
  type SuiteArtifactPointer,
  writeCanonicalSuiteArtifact,
  writeSuiteArtifactBytes,
} from "../contracts/suite-artifacts.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import { reconstructSuiteReport, replaySuiteReport } from "./replay.js";

export async function rebuildSuiteReport(input: {
  readonly instanceRoot: string;
  readonly suiteRoot: string;
}): Promise<{
  readonly report: SuiteReport;
  readonly reportPointer: SuiteArtifactPointer;
  readonly markdownPointer: SuiteArtifactPointer;
}> {
  const reconstructed = await reconstructSuiteReport(input.instanceRoot, input.suiteRoot);
  assertSecretFreeText(canonicalJson(reconstructed.evaluation));
  assertSecretFreeText(canonicalJson(reconstructed.report));
  assertSecretFreeText(reconstructed.markdown);
  await writeCanonicalSuiteArtifact(
    input.suiteRoot,
    "artifact://suite/evaluation.json",
    reconstructed.evaluation,
  );
  const reportPointer = await writeCanonicalSuiteArtifact(
    input.suiteRoot,
    "artifact://suite/report.json",
    reconstructed.report,
  );
  const markdownPointer = await writeSuiteArtifactBytes(
    input.suiteRoot,
    "artifact://suite/report.md",
    reconstructed.markdown,
  );
  await replaySuiteReport(input.instanceRoot, input.suiteRoot, reportPointer, { markdownPointer });
  return { report: reconstructed.report, reportPointer, markdownPointer };
}

export async function frozenSuiteReportPointer(suiteRoot: string): Promise<SuiteArtifactPointer> {
  return (await readSuiteArtifactBytesByRef(suiteRoot, "artifact://suite/report.json")).pointer;
}

export async function writeSuiteMeasurementInvalidEnvelope(input: {
  readonly suiteRoot: string;
  readonly suiteId: string;
  readonly reason?: SuiteInvalidEnvelope["reason"];
}): Promise<{
  readonly envelope: SuiteInvalidEnvelope;
  readonly reportPointer: SuiteArtifactPointer;
  readonly markdownPointer: SuiteArtifactPointer;
}> {
  const reason = input.reason ?? "ARTIFACT_INTEGRITY_FAILURE";
  const message =
    reason === "ARTIFACT_INTEGRITY_FAILURE"
      ? "Frozen Suite evidence failed integrity or semantic replay."
      : "Suite task measurement failed before a valid report could be produced.";
  const envelope = parseSuiteInvalidEnvelope({
    schema_version: 1,
    suite_id: input.suiteId,
    measurement_validity: "invalid",
    reason,
    message,
    claim_strength: "multi_task_diagnostic",
    effect_claim_eligible: false,
  });
  const markdown = [
    `# DSH Eval Lab Suite — ${input.suiteId}`,
    "",
    "Measurement validity: **invalid**",
    "",
    message,
    "",
    "No effect claim or lifecycle action is permitted.",
    "",
  ].join("\n");
  assertSecretFreeText(canonicalJson(envelope));
  assertSecretFreeText(markdown);
  const [reportPointer, markdownPointer] = await Promise.all([
    writeCanonicalSuiteArtifact(
      input.suiteRoot,
      "artifact://suite/measurement-invalid.json",
      envelope,
    ),
    writeSuiteArtifactBytes(input.suiteRoot, "artifact://suite/measurement-invalid.md", markdown),
  ]);
  return { envelope, reportPointer, markdownPointer };
}
