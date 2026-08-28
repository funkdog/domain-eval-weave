import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import {
  parseCommerceExperiment,
  parseCommercePairedEvaluation,
  parseCommercePairedImpactReport,
  parseCommerceVariant,
} from "../../src/commerce-withdrawal/campaign-contracts.js";
import { parseCommerceObservationCatalog } from "../../src/commerce-withdrawal/catalog.js";
import {
  parseCommerceClaimIr,
  parseCommerceDeliveryReport,
  parseCommerceGraderAdmission,
  parseCommerceOraclePlan,
} from "../../src/commerce-withdrawal/delivery-contracts.js";
import {
  validCommerceWithdrawalAdmission,
  validCommerceWithdrawalCatalog,
  validCommerceWithdrawalClaimIr,
  validCommerceWithdrawalControlVariant,
  validCommerceWithdrawalDeliveryReport,
  validCommerceWithdrawalExperiment,
  validCommerceWithdrawalOraclePlan,
  validCommerceWithdrawalPairedEvaluation,
  validCommerceWithdrawalPairedReport,
} from "../helpers/commerce-withdrawal-artifact-fixtures.js";
import { validControlVariant } from "../helpers/fixtures.js";

const faces = [
  ["claim-observation-catalog", validCommerceWithdrawalCatalog, parseCommerceObservationCatalog],
  ["claim-ir", validCommerceWithdrawalClaimIr, parseCommerceClaimIr],
  ["oracle-plan", validCommerceWithdrawalOraclePlan, parseCommerceOraclePlan],
  ["grader-admission", validCommerceWithdrawalAdmission, parseCommerceGraderAdmission],
  ["variant", validCommerceWithdrawalControlVariant, parseCommerceVariant],
  ["experiment", validCommerceWithdrawalExperiment, parseCommerceExperiment],
  ["paired-evaluation", validCommerceWithdrawalPairedEvaluation, parseCommercePairedEvaluation],
  ["paired-report", validCommerceWithdrawalPairedReport, parseCommercePairedImpactReport],
  [
    "delivery-evaluation-report",
    validCommerceWithdrawalDeliveryReport,
    parseCommerceDeliveryReport,
  ],
] as const;

async function commerceValidators() {
  const root = new URL("../../contracts/commerce-withdrawal/", import.meta.url);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  return Object.fromEntries(
    await Promise.all(
      faces.map(async ([name]) => {
        const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, root), "utf8"));
        return [name, ajv.compile(schema)] as const;
      }),
    ),
  );
}

test("Commerce withdrawal persisted faces have strict JSON Schema and runtime parser parity", async () => {
  const validators = await commerceValidators();
  for (const [name, value, parser] of faces) {
    const validate = validators[name];
    assert.ok(validate);
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(parser(value), value);

    const extra = { ...value, aggregate_score: 100 };
    assert.equal(validate(extra), false, `${name} accepted an unknown aggregate score`);
    assert.throws(() => parser(extra));
  }
});

test("Commerce withdrawal schemas reject template drift and non-canonical behavior order", async () => {
  const validators = await commerceValidators();
  const experiment = {
    ...validCommerceWithdrawalExperiment,
    template_id: "reservation-ledger-v1",
  };
  assert.equal(validators.experiment?.(experiment), false);
  assert.throws(() => parseCommerceExperiment(experiment));

  const catalog = structuredClone(validCommerceWithdrawalCatalog);
  const firstBehavior = catalog.behaviors[0];
  const secondBehavior = catalog.behaviors[1];
  assert.ok(firstBehavior && secondBehavior);
  catalog.behaviors[0] = secondBehavior;
  catalog.behaviors[1] = firstBehavior;
  assert.equal(validators["claim-observation-catalog"]?.(catalog), false);
  assert.throws(() => parseCommerceObservationCatalog(catalog));

  const plan = structuredClone(validCommerceWithdrawalOraclePlan);
  const firstCheck = plan.checks[0];
  const secondCheck = plan.checks[1];
  assert.ok(firstCheck && secondCheck);
  plan.checks[0] = secondCheck;
  plan.checks[1] = firstCheck;
  assert.equal(validators["oracle-plan"]?.(plan), false);
  assert.throws(() => parseCommerceOraclePlan(plan));
});

test("Commerce artifact refs reject traversal on both contract faces", async () => {
  const validators = await commerceValidators();
  const evaluation = structuredClone(validCommerceWithdrawalPairedEvaluation);
  evaluation.arms.control.episode.ref = "artifact://campaign/arms/../secret.json";
  assert.equal(validators["paired-evaluation"]?.(evaluation), false);
  assert.throws(() => parseCommercePairedEvaluation(evaluation));
});

test("Commerce withdrawal Variant is a v2 template-bound face, not a Reservation v1 artifact", async () => {
  const validators = await commerceValidators();
  assert.equal(validators.variant?.(validControlVariant), false);
  assert.throws(() => parseCommerceVariant(validControlVariant));
});
