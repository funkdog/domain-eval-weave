import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOwnerConfirmation,
  confirmationProjectionDigest,
} from "../../src/domain/confirmation.js";
import { validEvidenceCard, validOwnerConfirmation } from "../helpers/phase3a-fixtures.js";

test("owner confirmation binds a target projection rather than self-asserted actor strings", () => {
  assert.equal(
    validOwnerConfirmation.target.projection_sha256,
    confirmationProjectionDigest("evidence_card", validEvidenceCard),
  );
  assert.doesNotThrow(() =>
    assertOwnerConfirmation(validOwnerConfirmation, "evidence_card", validEvidenceCard, "confirm"),
  );

  const mutated = { ...validEvidenceCard, statement: "A different product policy." };
  assert.throws(() =>
    assertOwnerConfirmation(validOwnerConfirmation, "evidence_card", mutated, "confirm"),
  );
});

test("owner confirmation enforces target identity, authority scope, and decision", () => {
  assert.throws(() =>
    assertOwnerConfirmation(
      { ...validOwnerConfirmation, decision: "reject" },
      "evidence_card",
      validEvidenceCard,
      "confirm",
    ),
  );
  assert.throws(() =>
    assertOwnerConfirmation(
      {
        ...validOwnerConfirmation,
        authority_scope: { product_id: "other-product", domain_ids: ["payments"] },
      },
      "evidence_card",
      validEvidenceCard,
      "confirm",
    ),
  );
});
