import { writeArtifactBytes, writeCanonicalJsonArtifact } from "../contracts/artifacts.js";
import { canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { judgeDefinitionDigest } from "./admission.js";
import {
  type CodeQualityJudgeResult,
  type JudgeAdmission,
  type Phase3cArtifactPointer,
  parseCodeQualityJudgeContract,
  parseJudgeAdmission,
  parseJudgeInputManifest,
  parseSemanticJudgeContract,
  type SemanticJudgeResult,
} from "./contracts.js";
import { buildCodeQualityJudgeResult, buildSemanticJudgeResult } from "./judge.js";
import { executeJudgeRun, type JudgeCarrier, type JudgeMaterial } from "./judge-runner.js";

function refs(kind: "semantic" | "code_quality") {
  const root = `artifact://campaign/phase3c/${kind === "semantic" ? "semantic-judge" : "code-quality-judge"}`;
  return {
    contract: `${root}/contract.json`,
    admission: `${root}/admission.json`,
    prompt: `${root}/prompt.txt`,
    input: `${root}/input-manifest.json`,
    outputSchema: `${root}/output-schema.json`,
    result: `${root}/result.json`,
  } as const;
}

type JudgeAggregate = SemanticJudgeResult | CodeQualityJudgeResult;

export async function runAdmittedJudgeEvaluation(input: {
  readonly campaignRoot: string;
  readonly evaluationId: string;
  readonly contract: unknown;
  readonly admission: unknown;
  readonly promptTemplate: string;
  readonly inputManifest: unknown;
  readonly outputSchemaBytes: string;
  readonly materials: readonly JudgeMaterial[];
  readonly carrier: (repeatIndex: 1 | 2 | 3) => JudgeCarrier;
  readonly clock?: () => string;
  readonly timeoutMs: number;
}): Promise<
  | {
      readonly validity: "valid";
      readonly aggregate: JudgeAggregate;
      readonly aggregatePointer: Phase3cArtifactPointer;
    }
  | {
      readonly validity: "invalid";
      readonly aggregate: null;
      readonly aggregatePointer: null;
    }
> {
  const manifest = parseJudgeInputManifest(input.inputManifest);
  const kind = manifest.judge_kind;
  const contract =
    kind === "semantic"
      ? parseSemanticJudgeContract(input.contract)
      : parseCodeQualityJudgeContract(input.contract);
  const admission = parseJudgeAdmission(input.admission);
  if (
    admission.judge_kind !== kind ||
    admission.status !== "admitted" ||
    admission.judge_definition_sha256 !== judgeDefinitionDigest(contract) ||
    contract.calibration_admission_sha256 !== canonicalJsonDigest(admission) ||
    contract.prompt_sha256 !== sha256Hex(input.promptTemplate) ||
    contract.output_schema_sha256 !== sha256Hex(input.outputSchemaBytes)
  ) {
    throw new Error("Judge evaluation requires one exact admitted contract closure");
  }
  const target = refs(kind);
  const [contractPointer, admissionPointer, promptPointer, inputPointer, outputSchemaPointer] =
    await Promise.all([
      writeCanonicalJsonArtifact(input.campaignRoot, target.contract, contract),
      writeCanonicalJsonArtifact(input.campaignRoot, target.admission, admission),
      writeArtifactBytes(input.campaignRoot, target.prompt, input.promptTemplate),
      writeCanonicalJsonArtifact(input.campaignRoot, target.input, manifest),
      writeArtifactBytes(input.campaignRoot, target.outputSchema, input.outputSchemaBytes),
    ]);
  if (
    contract.calibration_admission_sha256 !== admissionPointer.sha256 ||
    contract.prompt_sha256 !== promptPointer.sha256 ||
    contract.output_schema_sha256 !== outputSchemaPointer.sha256 ||
    (kind === "semantic"
      ? manifest.judge_contract.sha256 !== contractPointer.sha256
      : manifest.rubric.sha256 !== contractPointer.sha256)
  ) {
    throw new Error("Persisted Judge common inputs drifted");
  }
  const clock = input.clock ?? (() => new Date().toISOString());
  const executions = [];
  for (const repeatIndex of [1, 2, 3] as const) {
    const execution = await executeJudgeRun({
      campaignRoot: input.campaignRoot,
      runId: `${kind}-${input.evaluationId}-r${repeatIndex}`,
      repeatIndex,
      contract,
      contractPointer,
      promptTemplate: input.promptTemplate,
      promptPointer,
      inputManifest: manifest,
      inputManifestPointer: inputPointer,
      outputSchemaPointer,
      outputSchemaBytes: input.outputSchemaBytes,
      materials: input.materials,
      startedAt: clock(),
      endedAt: clock,
      timeoutMs: input.timeoutMs,
      carrier: input.carrier(repeatIndex),
    });
    executions.push(execution);
  }
  if (
    executions.some((execution) => execution.result === null || execution.resultPointer === null)
  ) {
    return { validity: "invalid", aggregate: null, aggregatePointer: null };
  }
  const runResults = executions.map((execution) => execution.result);
  const runReceipts = executions.map((execution) => execution.receiptPointer) as [
    Phase3cArtifactPointer,
    Phase3cArtifactPointer,
    Phase3cArtifactPointer,
  ];
  const repeatResults = executions.map((execution) => execution.resultPointer) as [
    Phase3cArtifactPointer,
    Phase3cArtifactPointer,
    Phase3cArtifactPointer,
  ];
  const aggregate =
    kind === "semantic"
      ? buildSemanticJudgeResult({
          contract,
          runs: runResults,
          runReceipts,
          repeatResults,
        })
      : buildCodeQualityJudgeResult({
          contract,
          runs: runResults,
          runReceipts,
          repeatResults,
        });
  const aggregatePointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    target.result,
    aggregate,
  );
  return { validity: "valid", aggregate, aggregatePointer };
}

export function assertJudgeAdmissionKind(
  admissionInput: unknown,
  expectedKind: "semantic" | "code_quality",
): JudgeAdmission {
  const admission = parseJudgeAdmission(admissionInput);
  if (admission.judge_kind !== expectedKind || admission.status !== "admitted") {
    throw new Error(`Expected admitted ${expectedKind} Judge evidence`);
  }
  return admission;
}
