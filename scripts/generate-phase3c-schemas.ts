import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import {
  codeQualityJudgeContractSchema,
  codeQualityJudgeInputManifestSchema,
  codeQualityJudgeResultSchema,
  codeQualityJudgeRunResultSchema,
  deterministicObservationResultSchema,
  domainObservationNormalFormSchema,
  harnessEffectContractSchema,
  judgeCaseInputSetSchema,
  judgeAdmissionSchema,
  judgeExecutionManifestSchema,
  judgeFreezeReceiptSchema,
  judgeLabelsUnsealReceiptSchema,
  judgeLabelSetSchema,
  judgeRunDescriptorSchema,
  judgeRunReceiptSchema,
  observationBoundaryAdmissionSchema,
  observationAuthorityMapSchema,
  observationBoundarySpecSchema,
  phase3cDeliveryReportSchema,
  semanticJudgeContractSchema,
  semanticJudgeInputManifestSchema,
  semanticJudgeResultSchema,
  semanticJudgeRunResultSchema,
} from "../src/phase3c/contracts.js";
import {
  TDD_SKILL_BINDING,
  tddSkillDeploymentSchema,
  tddTaskRegistrySchema,
} from "../src/phase3c/tdd-binding.js";
import { PHASE3C_PUBLIC_OBSERVATION_CATALOG } from "../src/phase3c/vocabulary.js";

const outputRoot = new URL("../contracts/phase3c/", import.meta.url);
const execFileAsync = promisify(execFile);
const schemas = {
  "observation-authority-map": observationAuthorityMapSchema,
  "observation-boundary": observationBoundarySpecSchema,
  "deterministic-observation-result": deterministicObservationResultSchema,
  "observation-boundary-admission": observationBoundaryAdmissionSchema,
  "domain-observation-normal-form": domainObservationNormalFormSchema,
  "semantic-judge-contract": semanticJudgeContractSchema,
  "semantic-judge-run-result": semanticJudgeRunResultSchema,
  "semantic-judge-result": semanticJudgeResultSchema,
  "semantic-judge-input-manifest": semanticJudgeInputManifestSchema,
  "code-quality-judge-contract": codeQualityJudgeContractSchema,
  "code-quality-judge-run-result": codeQualityJudgeRunResultSchema,
  "code-quality-judge-result": codeQualityJudgeResultSchema,
  "code-quality-judge-input-manifest": codeQualityJudgeInputManifestSchema,
  "judge-run-descriptor": judgeRunDescriptorSchema,
  "judge-run-receipt": judgeRunReceiptSchema,
  "judge-case-input-set": judgeCaseInputSetSchema,
  "judge-label-set": judgeLabelSetSchema,
  "judge-freeze-receipt": judgeFreezeReceiptSchema,
  "judge-execution-manifest": judgeExecutionManifestSchema,
  "judge-labels-unseal-receipt": judgeLabelsUnsealReceiptSchema,
  "judge-admission": judgeAdmissionSchema,
  "harness-effect-contract": harnessEffectContractSchema,
  "tdd-task-registry": tddTaskRegistrySchema,
  "tdd-skill-deployment": tddSkillDeploymentSchema,
  "delivery-evaluation-report": phase3cDeliveryReportSchema,
} as const;

function freezeTuples(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) freezeTuples(entry);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.prefixItems)) {
    record.minItems = record.prefixItems.length;
    record.maxItems = record.prefixItems.length;
    record.items = false;
  }
  for (const entry of Object.values(record)) freezeTuples(entry);
}

await mkdir(outputRoot, { recursive: true });
await writeFile(
  new URL("public-observation-catalog.schema.json", outputRoot),
  `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://dsh-eval-lab.local/contracts/phase3c/public-observation-catalog.schema.json",
      const: PHASE3C_PUBLIC_OBSERVATION_CATALOG,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await writeFile(
  new URL("tdd-skill-binding.schema.json", outputRoot),
  `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://dsh-eval-lab.local/contracts/phase3c/tdd-skill-binding.schema.json",
      const: TDD_SKILL_BINDING,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

for (const [name, schema] of Object.entries(schemas)) {
  const generated = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  freezeTuples(generated);
  await writeFile(
    new URL(`${name}.schema.json`, outputRoot),
    `${JSON.stringify(
      {
        ...generated,
        $id: `https://dsh-eval-lab.local/contracts/phase3c/${name}.schema.json`,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

await execFileAsync(process.execPath, [
  fileURLToPath(new URL("../node_modules/@biomejs/biome/bin/biome", import.meta.url)),
  "format",
  "--write",
  fileURLToPath(outputRoot),
]);
