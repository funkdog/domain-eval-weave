import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { DEDICATED_RUNTIME_ROOT } from "../runtime-root.js";
import { buildJudgeExecutionManifest, buildJudgeFreezeReceipt } from "./admission.js";
import { parseJudgeCaseInputSet } from "./contracts.js";
import {
  CODE_QUALITY_JUDGE_DEFINITION_VERSION,
  CODE_QUALITY_JUDGE_PROMPT,
  createCodeQualityJudgeContract,
  createSemanticJudgeContract,
  SEMANTIC_JUDGE_DEFINITION_VERSION,
  SEMANTIC_JUDGE_PROMPT,
} from "./default-judges.js";
import {
  buildDefaultJudgeDevelopmentSet,
  getJudgeDevelopmentCases,
  judgeDevelopmentCaseInput,
} from "./judge-development.js";

const ZERO_SHA256 = "0".repeat(64);

function strictChild(root: string, target: string): boolean {
  const relation = relative(resolve(root), resolve(target));
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function assertPhysicalDirectory(path: string, expectedMode: number): Promise<void> {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o777) !== expectedMode ||
    (await realpath(path)) !== resolve(path)
  ) {
    throw new Error(`Judge authoring directory boundary is invalid: ${path}`);
  }
}

async function readLockedSet(path: string) {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600
  ) {
    throw new Error(`Judge locked set boundary is invalid: ${path}`);
  }
  const bytes = await readFile(path, "utf8");
  const value = parseJudgeCaseInputSet(JSON.parse(bytes));
  if (canonicalJson(value) !== bytes) throw new Error(`Judge locked set is not canonical: ${path}`);
  return value;
}

async function writePrivate(path: string, value: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { flag: "wx", mode: 0o600 });
  return sha256Hex(value);
}

function plusMilliseconds(value: string, amount: number): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error("Judge freeze timestamp must be canonical ISO-8601");
  }
  return new Date(timestamp + amount).toISOString();
}

interface FrozenJudgeBundleEntry {
  readonly definition_version: string;
  readonly prompt_sha256: string;
  readonly output_schema_sha256: string;
  readonly contract_definition_sha256: string;
  readonly development_set_sha256: string;
  readonly freeze_receipt_sha256: string;
  readonly locked_admission_execution_sha256: string;
  readonly locked_bias_execution_sha256: string;
}

export interface JudgeAuthoringBundleManifest {
  readonly schema_version: 1;
  readonly bundle_id: "phase3c-judge-authoring-v5";
  readonly curation_root: string;
  readonly frozen_at: string;
  readonly semantic: FrozenJudgeBundleEntry;
  readonly code_quality: FrozenJudgeBundleEntry;
}

export async function freezeDefaultJudgeDefinitions(input: {
  readonly curationRoot: string;
  readonly outputRoot: string;
  readonly semanticOutputSchemaBytes: string;
  readonly codeQualityOutputSchemaBytes: string;
  readonly frozenAt: string;
}): Promise<JudgeAuthoringBundleManifest> {
  if (!strictChild(DEDICATED_RUNTIME_ROOT, input.curationRoot)) {
    throw new Error("Judge curation root must be a strict child of the dedicated runtime root");
  }
  if (!strictChild(DEDICATED_RUNTIME_ROOT, input.outputRoot)) {
    throw new Error("Judge authoring root must be a strict child of the dedicated runtime root");
  }
  await assertPhysicalDirectory(input.curationRoot, 0o700);
  const setsRoot = `${input.curationRoot}/sets`;
  await assertPhysicalDirectory(setsRoot, 0o700);
  const [semanticAdmission, semanticBias, qualityAdmission, qualityBias] = await Promise.all([
    readLockedSet(`${setsRoot}/semantic-locked_admission-v1.json`),
    readLockedSet(`${setsRoot}/semantic-locked_bias-v1.json`),
    readLockedSet(`${setsRoot}/code_quality-locked_admission-v1.json`),
    readLockedSet(`${setsRoot}/code_quality-locked_bias-v1.json`),
  ]);

  const parent = dirname(input.outputRoot);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporaryRoot = await mkdtemp(`${parent}/.phase3c-judge-authoring-`);
  try {
    const freezeKind = async (kind: "semantic" | "code_quality") => {
      const prompt = kind === "semantic" ? SEMANTIC_JUDGE_PROMPT : CODE_QUALITY_JUDGE_PROMPT;
      const outputSchemaBytes =
        kind === "semantic" ? input.semanticOutputSchemaBytes : input.codeQualityOutputSchemaBytes;
      const contract =
        kind === "semantic"
          ? createSemanticJudgeContract({
              outputSchemaSha256: sha256Hex(outputSchemaBytes),
              calibrationAdmissionSha256: ZERO_SHA256,
            })
          : createCodeQualityJudgeContract({
              outputSchemaSha256: sha256Hex(outputSchemaBytes),
              calibrationAdmissionSha256: ZERO_SHA256,
            });
      const developmentSet = buildDefaultJudgeDevelopmentSet(kind);
      const developmentCases = getJudgeDevelopmentCases(kind);
      const admissionSet = kind === "semantic" ? semanticAdmission : qualityAdmission;
      const biasSet = kind === "semantic" ? semanticBias : qualityBias;
      const freeze = buildJudgeFreezeReceipt({
        judgeContract: contract,
        developmentSet,
        lockedAdmissionSet: admissionSet,
        lockedBiasSet: biasSet,
        frozenAt: input.frozenAt,
      });
      const createdAt = plusMilliseconds(input.frozenAt, 1);
      const admissionExecution = buildJudgeExecutionManifest({
        freezeReceipt: freeze,
        judgeContract: contract,
        inputSet: admissionSet,
        createdAt,
      });
      const biasExecution = buildJudgeExecutionManifest({
        freezeReceipt: freeze,
        judgeContract: contract,
        inputSet: biasSet,
        createdAt,
      });
      const target = `${temporaryRoot}/${kind}`;
      await mkdir(target, { mode: 0o700 });
      const developmentInputs = developmentCases.map(judgeDevelopmentCaseInput);
      const developmentExpectations = developmentCases.map((entry) => ({
        case_id: entry.caseId,
        expected_dimensions: entry.expectedDimensions,
      }));
      const [promptSha256, outputSchemaSha256] = await Promise.all([
        writePrivate(`${target}/prompt.txt`, prompt),
        writePrivate(`${target}/output-schema.json`, outputSchemaBytes),
        writePrivate(`${target}/contract-definition.json`, canonicalJson(contract)),
        writePrivate(`${target}/development-set.json`, canonicalJson(developmentSet)),
        writePrivate(`${target}/development-inputs.json`, canonicalJson(developmentInputs)),
        writePrivate(
          `${target}/development-expectations.json`,
          canonicalJson(developmentExpectations),
        ),
        writePrivate(`${target}/freeze-receipt.json`, canonicalJson(freeze)),
        writePrivate(
          `${target}/locked-admission-execution.json`,
          canonicalJson(admissionExecution),
        ),
        writePrivate(`${target}/locked-bias-execution.json`, canonicalJson(biasExecution)),
      ]);
      return {
        definition_version:
          kind === "semantic"
            ? SEMANTIC_JUDGE_DEFINITION_VERSION
            : CODE_QUALITY_JUDGE_DEFINITION_VERSION,
        prompt_sha256: promptSha256,
        output_schema_sha256: outputSchemaSha256,
        contract_definition_sha256: canonicalJsonDigest(contract),
        development_set_sha256: canonicalJsonDigest(developmentSet),
        freeze_receipt_sha256: canonicalJsonDigest(freeze),
        locked_admission_execution_sha256: canonicalJsonDigest(admissionExecution),
        locked_bias_execution_sha256: canonicalJsonDigest(biasExecution),
      } satisfies FrozenJudgeBundleEntry;
    };

    const [semantic, codeQuality] = await Promise.all([
      freezeKind("semantic"),
      freezeKind("code_quality"),
    ]);
    const manifest: JudgeAuthoringBundleManifest = {
      schema_version: 1,
      bundle_id: "phase3c-judge-authoring-v5",
      curation_root: resolve(input.curationRoot),
      frozen_at: input.frozenAt,
      semantic,
      code_quality: codeQuality,
    };
    await writePrivate(`${temporaryRoot}/manifest.json`, canonicalJson(manifest));
    await rename(temporaryRoot, input.outputRoot);
    return manifest;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
