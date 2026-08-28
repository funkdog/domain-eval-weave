import type { ArtifactPointer } from "../contracts/artifacts.js";
import {
  parseArtifactRef,
  readJsonArtifact,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import { judgeDefinitionDigest } from "./admission.js";
import {
  type Phase3cArtifactPointer,
  type Phase3cDeliveryReport,
  parseCodeQualityJudgeContract,
  parseCodeQualityJudgeResult,
  parseCodeQualityJudgeRunResult,
  parseDeterministicObservationResult,
  parseHarnessEffectContract,
  parseJudgeAdmission,
  parseJudgeRunReceipt,
  parseObservationAuthorityMap,
  parseObservationBoundarySpec,
  parsePhase3cDeliveryReport,
  parsePhase3cReplayManifest,
  parsePublicObservationCatalog,
  parseSemanticJudgeContract,
  parseSemanticJudgeResult,
  parseSemanticJudgeRunResult,
} from "./contracts.js";
import { buildCodeQualityJudgeResult, buildSemanticJudgeResult } from "./judge.js";
import { validateObservationBoundary } from "./observation.js";
import { buildPhase3cDeliveryReport } from "./report.js";
import { parseTddSkillBinding, parseTddTaskRegistry } from "./tdd-binding.js";

const REFS = {
  catalog: "artifact://campaign/phase3c/observation-boundary/public-catalog.json",
  authority: "artifact://campaign/phase3c/observation-boundary/authority-map.json",
  boundary: "artifact://campaign/phase3c/observation-boundary/boundary.json",
  deterministic: "artifact://campaign/phase3c/deterministic-results/result.json",
  semanticContract: "artifact://campaign/phase3c/semantic-judge/contract.json",
  semanticAdmission: "artifact://campaign/phase3c/semantic-judge/admission.json",
  semantic: "artifact://campaign/phase3c/semantic-judge/result.json",
  qualityContract: "artifact://campaign/phase3c/code-quality-judge/contract.json",
  qualityAdmission: "artifact://campaign/phase3c/code-quality-judge/admission.json",
  quality: "artifact://campaign/phase3c/code-quality-judge/result.json",
  tddBinding: "artifact://campaign/phase3c/harness-effect/tdd-skill-binding.json",
  taskRegistry: "artifact://campaign/phase3c/harness-effect/task-registry.json",
  harness: "artifact://campaign/phase3c/harness-effect/contract.json",
  report: "artifact://campaign/phase3c/verdict/report.json",
  markdown: "artifact://campaign/phase3c/verdict/report.md",
  manifest: "artifact://campaign/phase3c/replay-manifest.json",
} as const;

function pointer(value: Phase3cArtifactPointer): ArtifactPointer {
  return { ref: parseArtifactRef(value.ref), sha256: value.sha256 };
}

function samePointer(left: Phase3cArtifactPointer, right: Phase3cArtifactPointer): boolean {
  return left.ref === right.ref && left.sha256 === right.sha256;
}

function deliveryObservations(report: Phase3cDeliveryReport) {
  return [...report.axes.delivery.requirement_delta, ...report.axes.delivery.domain_preservation];
}

function tuple3<T>(values: readonly T[], label: string): [T, T, T] {
  const [first, second, third, ...extra] = values;
  if (first === undefined || second === undefined || third === undefined || extra.length !== 0) {
    throw new Error(`${label} must contain exactly three entries`);
  }
  return [first, second, third];
}

function requiredAt<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) throw new Error(`${label} is missing at ${index}`);
  return value;
}

function assertRepeatClosure(input: {
  readonly kind: "semantic" | "code_quality";
  readonly aggregate:
    | ReturnType<typeof parseSemanticJudgeResult>
    | ReturnType<typeof parseCodeQualityJudgeResult>;
  readonly runs: readonly (
    | ReturnType<typeof parseSemanticJudgeRunResult>
    | ReturnType<typeof parseCodeQualityJudgeRunResult>
  )[];
  readonly receipts: readonly ReturnType<typeof parseJudgeRunReceipt>[];
}): void {
  const runPointers = input.aggregate.repeat_results;
  const receiptPointers = input.aggregate.run_receipts;
  for (const [index, receipt] of input.receipts.entries()) {
    const runPointer = runPointers[index];
    const receiptPointer = receiptPointers[index];
    const run = input.runs[index];
    if (
      runPointer === undefined ||
      receiptPointer === undefined ||
      run === undefined ||
      receipt.judge_kind !== input.kind ||
      receipt.protocol_status !== "valid" ||
      receipt.output === null ||
      !samePointer(receipt.output, runPointer) ||
      receiptPointer.sha256 !== canonicalJsonDigest(receipt) ||
      runPointer.sha256 !== canonicalJsonDigest(run)
    ) {
      throw new Error(`${input.kind} Judge repeat closure drifted`);
    }
  }
}

function rebuildReport(report: Phase3cDeliveryReport): Phase3cDeliveryReport {
  return buildPhase3cDeliveryReport({
    evaluationId: report.evaluation_id,
    source: report.source,
    validity: {
      deterministic: report.measurement_validity.deterministic,
      semanticJudge: report.measurement_validity.semantic_judge,
      codeQualityJudge: report.measurement_validity.code_quality_judge,
      harnessMechanism: report.measurement_validity.harness_mechanism,
      cost: report.measurement_validity.cost,
      reasons: report.measurement_validity.reasons,
    },
    delivery: {
      requirementDelta: report.axes.delivery.requirement_delta,
      domainPreservation: report.axes.delivery.domain_preservation,
    },
    semantic: {
      required: report.axes.semantic.required,
      dimensions: report.axes.semantic.dimensions,
    },
    codeQuality: { dimensions: report.axes.code_quality.dimensions },
    harnessEffect: {
      contractSha256: report.axes.harness_effect.contract_sha256,
      status: report.axes.harness_effect.status,
      opportunity: report.axes.harness_effect.opportunity,
      activation: report.axes.harness_effect.activation,
      changedDeliveryClaims: report.axes.harness_effect.changed_delivery_claims,
      changedSemanticDimensions: report.axes.harness_effect.changed_semantic_dimensions,
      changedCodeQualityDimensions: report.axes.harness_effect.changed_code_quality_dimensions,
      costDelta: report.axes.harness_effect.cost_delta,
      claimStrength: report.axes.harness_effect.claim_strength,
    },
    traceability: report.traceability,
  });
}

export function renderPhase3cDeliveryReport(reportInput: unknown): string {
  const report = parsePhase3cDeliveryReport(reportInput);
  return [
    `# Phase 3C Delivery Evaluation ${report.evaluation_id}`,
    "",
    `Verdict: **${report.verdict}**`,
    "",
    "| Axis | Status |",
    "| --- | --- |",
    `| Delivery | ${report.axes.delivery.status} |`,
    `| Semantic | ${report.axes.semantic.status} |`,
    `| Code Quality | ${report.axes.code_quality.status} |`,
    `| Harness Effect | ${report.axes.harness_effect.status} |`,
    "",
    `Candidate validity: **${report.measurement_validity.candidate_verdict}**`,
    `Harness validity: **${report.measurement_validity.harness_effect}**`,
    "",
    "No cross-axis aggregate score is defined.",
    "",
  ].join("\n");
}

export async function persistPhase3cEvaluation(input: {
  readonly campaignRoot: string;
  readonly publicObservationCatalog: unknown;
  readonly observationAuthorityMap: unknown;
  readonly observationBoundary: unknown;
  readonly deterministicObservations: unknown;
  readonly claimAxes: Readonly<Record<string, "requirement_delta" | "domain_preservation">>;
  readonly semanticJudgeContract: unknown;
  readonly semanticJudgeAdmission: unknown;
  readonly semanticJudgeResult: unknown;
  readonly semanticJudgeRuns: readonly [unknown, unknown, unknown];
  readonly semanticJudgeRunReceipts: readonly [unknown, unknown, unknown];
  readonly codeQualityJudgeContract: unknown;
  readonly codeQualityJudgeAdmission: unknown;
  readonly codeQualityJudgeResult: unknown;
  readonly codeQualityJudgeRuns: readonly [unknown, unknown, unknown];
  readonly codeQualityJudgeRunReceipts: readonly [unknown, unknown, unknown];
  readonly tddSkillBinding: unknown;
  readonly taskRegistry: unknown;
  readonly harnessEffectContract: unknown;
  readonly deliveryReport: unknown;
}) {
  const catalog = parsePublicObservationCatalog(input.publicObservationCatalog);
  const authority = parseObservationAuthorityMap(input.observationAuthorityMap);
  const boundary = parseObservationBoundarySpec(input.observationBoundary);
  validateObservationBoundary({ boundary, authorityMap: authority, claimAxes: input.claimAxes });
  const deterministic = parseDeterministicObservationResult(input.deterministicObservations);
  const semanticContract = parseSemanticJudgeContract(input.semanticJudgeContract);
  const semanticAdmission = parseJudgeAdmission(input.semanticJudgeAdmission);
  const semantic = parseSemanticJudgeResult(input.semanticJudgeResult);
  const semanticRuns = input.semanticJudgeRuns.map(parseSemanticJudgeRunResult);
  const semanticReceipts = input.semanticJudgeRunReceipts.map(parseJudgeRunReceipt);
  const qualityContract = parseCodeQualityJudgeContract(input.codeQualityJudgeContract);
  const qualityAdmission = parseJudgeAdmission(input.codeQualityJudgeAdmission);
  const quality = parseCodeQualityJudgeResult(input.codeQualityJudgeResult);
  const qualityRuns = input.codeQualityJudgeRuns.map(parseCodeQualityJudgeRunResult);
  const qualityReceipts = input.codeQualityJudgeRunReceipts.map(parseJudgeRunReceipt);
  const tddBinding = parseTddSkillBinding(input.tddSkillBinding);
  const taskRegistry = parseTddTaskRegistry(input.taskRegistry);
  const harness = parseHarnessEffectContract(input.harnessEffectContract);
  const report = parsePhase3cDeliveryReport(input.deliveryReport);
  assertRepeatClosure({
    kind: "semantic",
    aggregate: semantic,
    runs: semanticRuns,
    receipts: semanticReceipts,
  });
  assertRepeatClosure({
    kind: "code_quality",
    aggregate: quality,
    runs: qualityRuns,
    receipts: qualityReceipts,
  });
  const rebuiltSemantic = buildSemanticJudgeResult({
    contract: semanticContract,
    runs: semanticRuns,
    runReceipts: tuple3(semantic.run_receipts, "Semantic receipt pointers"),
    repeatResults: tuple3(semantic.repeat_results, "Semantic result pointers"),
  });
  const rebuiltQuality = buildCodeQualityJudgeResult({
    contract: qualityContract,
    runs: qualityRuns,
    runReceipts: tuple3(quality.run_receipts, "Code Quality receipt pointers"),
    repeatResults: tuple3(quality.repeat_results, "Code Quality result pointers"),
  });
  if (
    canonicalJson(rebuiltSemantic) !== canonicalJson(semantic) ||
    canonicalJson(rebuiltQuality) !== canonicalJson(quality)
  ) {
    throw new Error("Phase 3C Judge aggregate drifted from its three repeats");
  }
  if (canonicalJson(rebuildReport(report)) !== canonicalJson(report)) {
    throw new Error("Phase 3C report verdict cannot be deterministically rebuilt");
  }
  for (const value of [
    catalog,
    authority,
    boundary,
    deterministic,
    semanticContract,
    semanticAdmission,
    semantic,
    semanticRuns,
    semanticReceipts,
    qualityContract,
    qualityAdmission,
    quality,
    qualityRuns,
    qualityReceipts,
    tddBinding,
    taskRegistry,
    harness,
    report,
  ]) {
    assertSecretFreeText(canonicalJson(value));
  }
  await Promise.all([
    ...semanticRuns.map((run, index) =>
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        requiredAt(semantic.repeat_results, index, "Semantic result pointer").ref,
        run,
      ),
    ),
    ...semanticReceipts.map((receipt, index) =>
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        requiredAt(semantic.run_receipts, index, "Semantic receipt pointer").ref,
        receipt,
      ),
    ),
    ...qualityRuns.map((run, index) =>
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        requiredAt(quality.repeat_results, index, "Code Quality result pointer").ref,
        run,
      ),
    ),
    ...qualityReceipts.map((receipt, index) =>
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        requiredAt(quality.run_receipts, index, "Code Quality receipt pointer").ref,
        receipt,
      ),
    ),
  ]);
  const [
    catalogPointer,
    authorityPointer,
    boundaryPointer,
    deterministicPointer,
    semanticContractPointer,
    semanticAdmissionPointer,
    semanticPointer,
    qualityContractPointer,
    qualityAdmissionPointer,
    qualityPointer,
    tddBindingPointer,
    taskRegistryPointer,
    harnessPointer,
  ] = await Promise.all([
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.catalog, catalog),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.authority, authority),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.boundary, boundary),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.deterministic, deterministic),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.semanticContract, semanticContract),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.semanticAdmission, semanticAdmission),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.semantic, semantic),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.qualityContract, qualityContract),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.qualityAdmission, qualityAdmission),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.quality, quality),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.tddBinding, tddBinding),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.taskRegistry, taskRegistry),
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.harness, harness),
  ]);
  if (
    authority.catalog_sha256 !== catalogPointer.sha256 ||
    boundary.public_observation_catalog_sha256 !== catalogPointer.sha256 ||
    boundary.authority_map_sha256 !== authorityPointer.sha256 ||
    deterministic.boundary_sha256 !== boundaryPointer.sha256 ||
    semanticAdmission.judge_kind !== "semantic" ||
    semanticAdmission.status !== "admitted" ||
    semanticAdmission.judge_definition_sha256 !== judgeDefinitionDigest(semanticContract) ||
    semanticContract.calibration_admission_sha256 !== semanticAdmissionPointer.sha256 ||
    semantic.judge_contract_sha256 !== semanticContractPointer.sha256 ||
    qualityAdmission.judge_kind !== "code_quality" ||
    qualityAdmission.status !== "admitted" ||
    qualityAdmission.judge_definition_sha256 !== judgeDefinitionDigest(qualityContract) ||
    qualityContract.calibration_admission_sha256 !== qualityAdmissionPointer.sha256 ||
    quality.rubric_sha256 !== qualityContractPointer.sha256 ||
    canonicalJson(deliveryObservations(report)) !== canonicalJson(deterministic.observations) ||
    report.measurement_validity.deterministic !== deterministic.measurement_validity ||
    canonicalJson(report.axes.semantic.dimensions) !== canonicalJson(semantic.dimensions) ||
    canonicalJson(report.axes.code_quality.dimensions) !== canonicalJson(quality.dimensions) ||
    !samePointer(report.source.deterministic_observations, deterministicPointer) ||
    !samePointer(report.source.semantic_judge_contract, semanticContractPointer) ||
    !samePointer(report.source.semantic_judge_admission, semanticAdmissionPointer) ||
    !samePointer(report.source.observation_boundary, boundaryPointer) ||
    !samePointer(report.source.semantic_judge, semanticPointer) ||
    !samePointer(report.source.code_quality_judge, qualityPointer) ||
    !samePointer(report.source.code_quality_judge_contract, qualityContractPointer) ||
    !samePointer(report.source.code_quality_judge_admission, qualityAdmissionPointer) ||
    !samePointer(report.source.tdd_skill_binding, tddBindingPointer) ||
    !samePointer(report.source.task_registry, taskRegistryPointer) ||
    taskRegistry.skill_binding_sha256 !== tddBindingPointer.sha256 ||
    harness.harness_binding_sha256 !== tddBindingPointer.sha256 ||
    harness.task_registry_sha256 !== taskRegistryPointer.sha256 ||
    !samePointer(report.source.harness_effect_contract, harnessPointer) ||
    report.axes.harness_effect.contract_sha256 !== harnessPointer.sha256
  ) {
    throw new Error("Phase 3C primary artifact closure drifted");
  }
  const markdown = renderPhase3cDeliveryReport(report);
  assertSecretFreeText(markdown);
  const [reportPointer, markdownPointer] = await Promise.all([
    writeCanonicalJsonArtifact(input.campaignRoot, REFS.report, report),
    writeArtifactBytes(input.campaignRoot, REFS.markdown, markdown),
  ]);
  const manifest = parsePhase3cReplayManifest({
    schema_version: 1,
    template_id: "commerce-order-cancellation-v3",
    public_observation_catalog: catalogPointer,
    observation_authority_map: authorityPointer,
    observation_boundary: boundaryPointer,
    deterministic_observations: deterministicPointer,
    semantic_judge_contract: semanticContractPointer,
    semantic_judge_admission: semanticAdmissionPointer,
    semantic_judge_result: semanticPointer,
    code_quality_judge_contract: qualityContractPointer,
    code_quality_judge_admission: qualityAdmissionPointer,
    code_quality_judge_result: qualityPointer,
    tdd_skill_binding: tddBindingPointer,
    task_registry: taskRegistryPointer,
    harness_effect_contract: harnessPointer,
    delivery_report: reportPointer,
  });
  const manifestPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    REFS.manifest,
    manifest,
  );
  await replayPhase3cEvaluation({ campaignRoot: input.campaignRoot, manifestPointer });
  return { manifest, report, manifestPointer, reportPointer, markdownPointer };
}

export async function replayPhase3cEvaluation(input: {
  readonly campaignRoot: string;
  readonly manifestPointer: Phase3cArtifactPointer;
}) {
  if (input.manifestPointer.ref !== REFS.manifest) {
    throw new Error("Phase 3C replay requires the frozen manifest ref");
  }
  const manifest = await readJsonArtifact(
    input.campaignRoot,
    pointer(input.manifestPointer),
    parsePhase3cReplayManifest,
  );
  const [
    catalog,
    authority,
    boundary,
    deterministic,
    semanticContract,
    semanticAdmission,
    semantic,
    qualityContract,
    qualityAdmission,
    quality,
    tddBinding,
    taskRegistry,
    harness,
    report,
  ] = await Promise.all([
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.public_observation_catalog),
      parsePublicObservationCatalog,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.observation_authority_map),
      parseObservationAuthorityMap,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.observation_boundary),
      parseObservationBoundarySpec,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.deterministic_observations),
      parseDeterministicObservationResult,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.semantic_judge_contract),
      parseSemanticJudgeContract,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.semantic_judge_admission),
      parseJudgeAdmission,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.semantic_judge_result),
      parseSemanticJudgeResult,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.code_quality_judge_contract),
      parseCodeQualityJudgeContract,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.code_quality_judge_admission),
      parseJudgeAdmission,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.code_quality_judge_result),
      parseCodeQualityJudgeResult,
    ),
    readJsonArtifact(input.campaignRoot, pointer(manifest.tdd_skill_binding), parseTddSkillBinding),
    readJsonArtifact(input.campaignRoot, pointer(manifest.task_registry), parseTddTaskRegistry),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.harness_effect_contract),
      parseHarnessEffectContract,
    ),
    readJsonArtifact(
      input.campaignRoot,
      pointer(manifest.delivery_report),
      parsePhase3cDeliveryReport,
    ),
  ]);
  const [semanticRuns, semanticReceipts, qualityRuns, qualityReceipts] = await Promise.all([
    Promise.all(
      semantic.repeat_results.map((entry) =>
        readJsonArtifact(input.campaignRoot, pointer(entry), parseSemanticJudgeRunResult),
      ),
    ),
    Promise.all(
      semantic.run_receipts.map((entry) =>
        readJsonArtifact(input.campaignRoot, pointer(entry), parseJudgeRunReceipt),
      ),
    ),
    Promise.all(
      quality.repeat_results.map((entry) =>
        readJsonArtifact(input.campaignRoot, pointer(entry), parseCodeQualityJudgeRunResult),
      ),
    ),
    Promise.all(
      quality.run_receipts.map((entry) =>
        readJsonArtifact(input.campaignRoot, pointer(entry), parseJudgeRunReceipt),
      ),
    ),
  ]);
  assertRepeatClosure({
    kind: "semantic",
    aggregate: semantic,
    runs: semanticRuns,
    receipts: semanticReceipts,
  });
  assertRepeatClosure({
    kind: "code_quality",
    aggregate: quality,
    runs: qualityRuns,
    receipts: qualityReceipts,
  });
  const rebuiltSemantic = buildSemanticJudgeResult({
    contract: semanticContract,
    runs: semanticRuns,
    runReceipts: tuple3(semantic.run_receipts, "Semantic receipt pointers"),
    repeatResults: tuple3(semantic.repeat_results, "Semantic result pointers"),
  });
  const rebuiltQuality = buildCodeQualityJudgeResult({
    contract: qualityContract,
    runs: qualityRuns,
    runReceipts: tuple3(quality.run_receipts, "Code Quality receipt pointers"),
    repeatResults: tuple3(quality.repeat_results, "Code Quality result pointers"),
  });
  if (
    authority.catalog_sha256 !== manifest.public_observation_catalog.sha256 ||
    boundary.public_observation_catalog_sha256 !== manifest.public_observation_catalog.sha256 ||
    boundary.authority_map_sha256 !== manifest.observation_authority_map.sha256 ||
    deterministic.boundary_sha256 !== manifest.observation_boundary.sha256 ||
    semanticAdmission.judge_kind !== "semantic" ||
    semanticAdmission.status !== "admitted" ||
    semanticAdmission.judge_definition_sha256 !== judgeDefinitionDigest(semanticContract) ||
    semanticContract.calibration_admission_sha256 !== manifest.semantic_judge_admission.sha256 ||
    semantic.judge_contract_sha256 !== manifest.semantic_judge_contract.sha256 ||
    qualityAdmission.judge_kind !== "code_quality" ||
    qualityAdmission.status !== "admitted" ||
    qualityAdmission.judge_definition_sha256 !== judgeDefinitionDigest(qualityContract) ||
    qualityContract.calibration_admission_sha256 !== manifest.code_quality_judge_admission.sha256 ||
    quality.rubric_sha256 !== manifest.code_quality_judge_contract.sha256 ||
    canonicalJson(deliveryObservations(report)) !== canonicalJson(deterministic.observations) ||
    report.measurement_validity.deterministic !== deterministic.measurement_validity ||
    canonicalJson(report.axes.semantic.dimensions) !== canonicalJson(semantic.dimensions) ||
    canonicalJson(report.axes.code_quality.dimensions) !== canonicalJson(quality.dimensions) ||
    canonicalJson(rebuiltSemantic) !== canonicalJson(semantic) ||
    canonicalJson(rebuiltQuality) !== canonicalJson(quality) ||
    !samePointer(report.source.deterministic_observations, manifest.deterministic_observations) ||
    !samePointer(report.source.observation_boundary, manifest.observation_boundary) ||
    !samePointer(report.source.semantic_judge, manifest.semantic_judge_result) ||
    !samePointer(report.source.semantic_judge_contract, manifest.semantic_judge_contract) ||
    !samePointer(report.source.semantic_judge_admission, manifest.semantic_judge_admission) ||
    !samePointer(report.source.code_quality_judge, manifest.code_quality_judge_result) ||
    !samePointer(report.source.code_quality_judge_contract, manifest.code_quality_judge_contract) ||
    !samePointer(
      report.source.code_quality_judge_admission,
      manifest.code_quality_judge_admission,
    ) ||
    !samePointer(report.source.tdd_skill_binding, manifest.tdd_skill_binding) ||
    !samePointer(report.source.task_registry, manifest.task_registry) ||
    taskRegistry.skill_binding_sha256 !== canonicalJsonDigest(tddBinding) ||
    harness.harness_binding_sha256 !== canonicalJsonDigest(tddBinding) ||
    harness.task_registry_sha256 !== canonicalJsonDigest(taskRegistry) ||
    !samePointer(report.source.harness_effect_contract, manifest.harness_effect_contract) ||
    report.axes.harness_effect.contract_sha256 !== canonicalJsonDigest(harness) ||
    canonicalJson(rebuildReport(report)) !== canonicalJson(report)
  ) {
    throw new Error("Phase 3C artifact-only replay closure drifted");
  }
  return {
    manifest,
    catalog,
    authority,
    boundary,
    deterministic,
    semanticContract,
    semanticAdmission,
    semantic,
    semanticRuns,
    semanticReceipts,
    qualityContract,
    qualityAdmission,
    quality,
    qualityRuns,
    qualityReceipts,
    tddBinding,
    taskRegistry,
    harness,
    report,
  };
}
