import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readArtifactBytesByRef,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../src/contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../src/contracts/canonical-json.js";
import { DshJudgeCarrier } from "../src/carrier/dsh-judge.js";
import { ensurePhase3cJudgeLayout } from "../src/instance.js";
import {
  buildDefaultJudgeDevelopmentSet,
  developmentCaseMatches,
  developmentJudgeCaseSource,
  executeJudgeCase,
  getJudgeDevelopmentCases,
  judgeCohortDigest,
  judgeDefinitionDigest,
  lockedJudgeCaseSource,
  parseJudgeCaseInputSet,
  parseJudgeExecutionManifest,
  parseJudgeFreezeReceipt,
  parseCodeQualityJudgeResult,
  parseSemanticJudgeResult,
} from "../src/phase3c/index.js";

type Mode = "development" | "locked_admission" | "locked_bias";
type JudgeKind = "semantic" | "code_quality";

const rawArguments = process.argv.slice(2);
const positionalArguments = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
const [
  modeInput,
  kindInput,
  authoringRoot,
  curationRoot,
  outputRoot,
  dshExecutable,
  caseFilter,
  resumeInput,
] = positionalArguments;
const resumeExisting = resumeInput === "resume" || caseFilter === "resume";
const effectiveCaseFilter = caseFilter === "resume" ? undefined : caseFilter;
if (
  (modeInput !== "development" &&
    modeInput !== "locked_admission" &&
    modeInput !== "locked_bias") ||
  (kindInput !== "semantic" && kindInput !== "code_quality") ||
  authoringRoot === undefined ||
  curationRoot === undefined ||
  outputRoot === undefined ||
  dshExecutable === undefined
) {
  throw new Error(
    "usage: run-phase3c-judge-cohort <development|locked_admission|locked_bias> <semantic|code_quality> <authoring-root> <curation-root> <output-root> <dsh-executable>",
  );
}
const mode = modeInput as Mode;
const kind = kindInput as JudgeKind;
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const judgeRoot = `${authoringRoot}/${kind}`;
const [promptTemplate, outputSchemaBytes, contractBytes, freezeBytes] = await Promise.all([
  readFile(`${judgeRoot}/prompt.txt`, "utf8"),
  readFile(`${judgeRoot}/output-schema.json`, "utf8"),
  readFile(`${judgeRoot}/contract-definition.json`, "utf8"),
  readFile(`${judgeRoot}/freeze-receipt.json`, "utf8"),
]);
const contract = JSON.parse(contractBytes) as unknown;
const freeze = parseJudgeFreezeReceipt(JSON.parse(freezeBytes));
if (
  freeze.judge_kind !== kind ||
  freeze.judge_definition_sha256 !== judgeDefinitionDigest(contract) ||
  freeze.prompt_sha256 !== sha256Hex(promptTemplate) ||
  freeze.output_schema_sha256 !== sha256Hex(outputSchemaBytes)
) {
  throw new Error("Judge authoring bundle drifted before cohort execution");
}

let set = buildDefaultJudgeDevelopmentSet(kind);
let executionManifest = null;
if (mode !== "development") {
  const setPrefix = kind === "semantic" ? "semantic" : "code_quality";
  const setBytes = await readFile(`${curationRoot}/sets/${setPrefix}-${mode}-v1.json`, "utf8");
  set = parseJudgeCaseInputSet(JSON.parse(setBytes));
  if (canonicalJson(set) !== setBytes) throw new Error("Judge locked set is not canonical");
  const executionBytes = await readFile(
    `${judgeRoot}/${mode === "locked_admission" ? "locked-admission" : "locked-bias"}-execution.json`,
    "utf8",
  );
  executionManifest = parseJudgeExecutionManifest(JSON.parse(executionBytes));
  if (
    executionManifest.judge_kind !== kind ||
    executionManifest.set_kind !== mode ||
    executionManifest.freeze_receipt_sha256 !== canonicalJsonDigest(freeze) ||
    executionManifest.judge_definition_sha256 !== judgeDefinitionDigest(contract) ||
    executionManifest.input_set_sha256 !== canonicalJsonDigest(set)
  ) {
    throw new Error("Judge locked execution manifest drifted before cohort execution");
  }
}
if (effectiveCaseFilter !== undefined) {
  if (mode !== "development") {
    throw new Error("Judge case filtering is allowed only for development probes");
  }
  const selected = set.cases.find((entry) => entry.case_id === effectiveCaseFilter);
  if (selected === undefined)
    throw new Error(`Unknown Judge development case: ${effectiveCaseFilter}`);
  set = parseJudgeCaseInputSet({
    ...set,
    set_id: `${set.set_id}-probe-${effectiveCaseFilter}`,
    cases: [selected],
  });
}

await mkdir(dirname(outputRoot), { recursive: true, mode: 0o700 });
await mkdir(outputRoot, { recursive: resumeExisting, mode: 0o700 });
await ensurePhase3cJudgeLayout();
const commonRoot = `artifact://campaign/phase3c/judge-cohort/${kind}`;
const [contractPointer, promptPointer, outputSchemaPointer, setPointer, freezePointer] =
  await Promise.all([
    writeCanonicalJsonArtifact(outputRoot, `${commonRoot}/contract-definition.json`, contract),
    writeArtifactBytes(outputRoot, `${commonRoot}/prompt.txt`, promptTemplate),
    writeArtifactBytes(outputRoot, `${commonRoot}/output-schema.json`, outputSchemaBytes),
    writeCanonicalJsonArtifact(outputRoot, `${commonRoot}/${mode}-set.json`, set),
    writeCanonicalJsonArtifact(outputRoot, `${commonRoot}/freeze-receipt.json`, freeze),
  ]);
const executionPointer =
  executionManifest === null
    ? null
    : await writeCanonicalJsonArtifact(
        outputRoot,
        `${commonRoot}/${mode}-execution.json`,
        executionManifest,
      );

const development = mode === "development" ? getJudgeDevelopmentCases(kind) : [];
const workspacesParent = `${resolve(outputRoot)}/.workspaces`;
if (resumeExisting) await rm(workspacesParent, { recursive: true, force: true });
await mkdir(workspacesParent, { mode: 0o700 });
const results = [];
if (resumeExisting) {
  const runsRoot = `${resolve(outputRoot)}/phase3c/${kind === "semantic" ? "semantic-judge" : "code-quality-judge"}/runs`;
  let runDirectories: string[] = [];
  try {
    runDirectories = await readdir(runsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const entry of set.cases) {
    const caseRoot = `artifact://campaign/phase3c/judge-cohort/${kind}/cases/${entry.case_id}`;
    let aggregateArtifact: Awaited<ReturnType<typeof readArtifactBytesByRef>>;
    try {
      aggregateArtifact = await readArtifactBytesByRef(outputRoot, `${caseRoot}/aggregate.json`);
    } catch {
      continue;
    }
    const aggregate =
      kind === "semantic"
        ? parseSemanticJudgeResult(JSON.parse(aggregateArtifact.bytes.toString("utf8")))
        : parseCodeQualityJudgeResult(JSON.parse(aggregateArtifact.bytes.toString("utf8")));
    const inputArtifact = await readArtifactBytesByRef(outputRoot, `${caseRoot}/input-manifest.json`);
    const attemptReceipts = [];
    for (const directory of runDirectories.filter((name) => name.includes(`-${entry.case_id}-r`))) {
      const receiptRef = `artifact://campaign/phase3c/${kind === "semantic" ? "semantic-judge" : "code-quality-judge"}/runs/${directory}/receipt.json`;
      attemptReceipts.push((await readArtifactBytesByRef(outputRoot, receiptRef)).pointer);
    }
    results.push({
      case_id: entry.case_id,
      judge_kind: kind,
      input_manifest: inputArtifact.pointer,
      attempt_receipts: attemptReceipts,
      run_receipts: aggregate.run_receipts,
      repeat_results: aggregate.repeat_results,
      aggregate: aggregateArtifact.pointer,
      observed_dimensions: aggregate.dimensions.map((dimension) => ({
        dimension_id: dimension.dimension_id,
        applicability: dimension.applicability,
        verdict: dimension.verdict,
        severity: dimension.severity,
        matched_condition_ids: dimension.matched_condition_ids,
        abstention_reason: dimension.abstention_reason,
      })),
    });
  }
}
let failure: unknown;
try {
  for (const [index, entry] of set.cases.entries()) {
    if (results.some((result) => result.case_id === entry.case_id)) {
      process.stderr.write(`resumed ${kind} ${mode} ${index + 1}/${set.cases.length}\n`);
      continue;
    }
    const source =
      mode === "development"
        ? developmentJudgeCaseSource(
            development.find((candidate) => candidate.caseId === entry.case_id) ??
              (() => {
                throw new Error(`Judge development case is missing: ${entry.case_id}`);
              })(),
          )
        : await lockedJudgeCaseSource({ curationRoot, set, caseId: entry.case_id });
    const workspaces = await Promise.all(
      ([1, 2, 3] as const).map((repeat) =>
        mkdtemp(`${workspacesParent}/${entry.case_id}-r${repeat}-`),
      ),
    );
    try {
      const result = await executeJudgeCase({
        campaignRoot: outputRoot,
        cohortId: `${mode}-${kind}${resumeExisting ? `-resume-${Date.now()}` : ""}`,
        source,
        contract,
        contractPointer,
        promptTemplate,
        promptPointer,
        outputSchemaBytes,
        outputSchemaPointer,
        carrier: (repeatIndex) =>
          new DshJudgeCarrier({
            launch: { executable: dshExecutable },
            workspace: workspaces[repeatIndex - 1] as string,
            commonPatch: `${packageRoot}/variants/common.patch.yml`,
            judgePatch: `${packageRoot}/variants/judge.patch.yml`,
          }),
        timeoutMs: 300_000,
        maxAttemptsPerRepeat: 5,
      });
      results.push(result);
      process.stderr.write(`completed ${kind} ${mode} ${index + 1}/${set.cases.length}\n`);
    } finally {
      await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
    }
  }
} catch (error) {
  failure = error;
} finally {
  await rm(workspacesParent, { recursive: true, force: true });
}

const developmentMatches =
  mode === "development"
    ? results.map((result) => {
        const source = development.find((candidate) => candidate.caseId === result.case_id);
        if (source === undefined) throw new Error("Judge development result has no source case");
        return { case_id: result.case_id, match: developmentCaseMatches(source, result) };
      })
    : [];
const summary = {
  schema_version: 1,
  cohort_id: `phase3c-${kind}-${mode}-v2`,
  judge_kind: kind,
  set_kind: mode,
  judge_definition_sha256: judgeDefinitionDigest(contract),
  freeze_receipt_sha256: freezePointer.sha256,
  execution_manifest_sha256: executionPointer?.sha256 ?? null,
  input_set_sha256: setPointer.sha256,
  completed_cases: results.length,
  expected_cases: set.cases.length,
  protocol_status: failure === undefined && results.length === set.cases.length ? "valid" : "invalid",
  development_matches: developmentMatches,
  case_results: results,
  cohort_sha256: judgeCohortDigest(results),
};
const summaryPointer = await writeCanonicalJsonArtifact(
  outputRoot,
  `${commonRoot}/${mode}-summary${resumeExisting ? `-resume-${Date.now()}` : ""}.json`,
  summary,
);
process.stdout.write(
  `${canonicalJson({
    judge_kind: kind,
    set_kind: mode,
    completed_cases: results.length,
    expected_cases: set.cases.length,
    protocol_status: summary.protocol_status,
    development_matches:
      mode === "development"
        ? `${developmentMatches.filter((entry) => entry.match).length}/${developmentMatches.length}`
        : null,
    summary_sha256: summaryPointer.sha256,
  })}\n`,
);
if (failure !== undefined) throw failure;
if (summary.protocol_status !== "valid") throw new Error("Judge cohort execution is incomplete");
