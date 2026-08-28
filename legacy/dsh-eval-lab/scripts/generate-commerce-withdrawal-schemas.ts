import { mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import {
  commerceExperimentSchema,
  commercePairedEvaluationSchema,
  commercePairedImpactReportSchema,
  commerceVariantSchema,
} from "../src/commerce-withdrawal/campaign-contracts.js";
import { commerceObservationCatalogSchema } from "../src/commerce-withdrawal/catalog.js";
import {
  commerceClaimIrSchema,
  commerceDeliveryReportSchema,
  commerceGraderAdmissionSchema,
  commerceOraclePlanSchema,
} from "../src/commerce-withdrawal/delivery-contracts.js";
import { COMMERCE_BEHAVIORS } from "../src/oracle/commerce-order-v2.js";

const frozenCatalog = JSON.parse(
  await readFile(
    new URL(
      "../task-packs/open-coding-ts-commerce-order-v2/claim-observation-catalog.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  counterexamples: Array<{ candidate_id: string; expected_failures: string[] }>;
};

const outputRoot = new URL("../contracts/commerce-withdrawal/", import.meta.url);
const schemas = {
  "claim-observation-catalog": commerceObservationCatalogSchema,
  "claim-ir": commerceClaimIrSchema,
  "oracle-plan": commerceOraclePlanSchema,
  "grader-admission": commerceGraderAdmissionSchema,
  variant: commerceVariantSchema,
  experiment: commerceExperimentSchema,
  "paired-evaluation": commercePairedEvaluationSchema,
  "paired-report": commercePairedImpactReportSchema,
  "delivery-evaluation-report": commerceDeliveryReportSchema,
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freezeOrderedArrays(name: string, generated: Record<string, unknown>): void {
  const properties = generated.properties as Record<string, unknown> | undefined;
  if (name === "claim-observation-catalog") {
    const behaviors = properties?.behaviors as Record<string, unknown>;
    const behaviorItem = behaviors.items as Record<string, unknown>;
    behaviors.prefixItems = COMMERCE_BEHAVIORS.map((behavior) => {
      const item = clone(behaviorItem);
      const itemProperties = item.properties as Record<string, Record<string, unknown>>;
      itemProperties.behavior_id = { const: behavior };
      itemProperties.template_id = { const: "commerce-order-cancellation-v2" };
      return item;
    });
    delete behaviors.items;

    const counterexamples = properties?.counterexamples as Record<string, unknown>;
    const counterexampleItem = counterexamples.items as Record<string, unknown>;
    counterexamples.prefixItems = frozenCatalog.counterexamples.map((entry) => {
      const item = clone(counterexampleItem);
      const itemProperties = item.properties as Record<string, Record<string, unknown>>;
      itemProperties.candidate_id = { const: entry.candidate_id };
      itemProperties.expected_failures = {
        type: "array",
        prefixItems: entry.expected_failures.map((failure) => ({ const: failure })),
      };
      return item;
    });
    delete counterexamples.items;
  }
  if (name === "oracle-plan") {
    const checks = properties?.checks as Record<string, unknown>;
    const checkItem = checks.items as Record<string, unknown>;
    checks.prefixItems = COMMERCE_BEHAVIORS.map((behavior) => {
      const item = clone(checkItem);
      const itemProperties = item.properties as Record<string, Record<string, unknown>>;
      itemProperties.behavior_id = { const: behavior };
      itemProperties.template_id = { const: "commerce-order-cancellation-v2" };
      return item;
    });
    delete checks.items;
  }
}

await mkdir(outputRoot, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const generated = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  freezeOrderedArrays(name, generated);
  freezeTuples(generated);
  await writeFile(
    new URL(`${name}.schema.json`, outputRoot),
    `${JSON.stringify(
      {
        ...generated,
        $id: `https://dsh-eval-lab.local/contracts/commerce-withdrawal/${name}.schema.json`,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
