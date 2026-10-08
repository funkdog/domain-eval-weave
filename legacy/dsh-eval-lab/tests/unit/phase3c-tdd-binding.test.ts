import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";

import {
  createTddHarnessEffectContract,
  parseTddSkillBinding,
  parseTddTaskEntry,
  parseTddTaskRegistry,
  projectTddMechanism,
  TDD_SKILL_BINDING,
  unavailableTddSkillDeployment,
} from "../../src/phase3c/index.js";

test("external TDD Skill binding freezes exact upstream content and license", () => {
  const parsed = parseTddSkillBinding(TDD_SKILL_BINDING);
  assert.equal(parsed.commit, "5b15a47f2d7150f545fbcacbfe381787fc0230dc");
  assert.equal(parsed.files.length, 4);
  assert.equal(
    parsed.license.sha256,
    "0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5",
  );
  assert.throws(() => parseTddSkillBinding({ ...TDD_SKILL_BINDING, commit: "main" }));
  assert.deepEqual(unavailableTddSkillDeployment("skill_not_installed"), {
    schema_version: 1,
    availability: "unavailable",
    skill_binding_sha256: canonicalJsonDigest(TDD_SKILL_BINDING),
    reason: "skill_not_installed",
  });
});

const task = {
  schema_version: 1,
  task_id: "commerce-tdd-suitable-v1",
  bucket: "TDD-suitable",
  preconfirmed_test_seams: ["OrderService.cancelOrder", "OrderService.getOrder"],
  allowed_test_roots: ["test/public"],
  allowed_production_roots: ["src"],
};

test("TDD Task entry requires preconfirmed seams and disjoint roots", () => {
  assert.deepEqual(parseTddTaskEntry(task), task);
  assert.throws(() => parseTddTaskEntry({ ...task, preconfirmed_test_seams: [] }));
  assert.throws(() =>
    parseTddTaskEntry({ ...task, allowed_test_roots: ["src"], allowed_production_roots: ["src"] }),
  );
});

test("checked-in TDD Registry covers every opportunity bucket once", async () => {
  const registry = parseTddTaskRegistry(
    JSON.parse(
      await readFile(
        new URL("../../registry/phase3c-tdd-task-registry.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.deepEqual(
    registry.tasks.map((entry) => entry.bucket),
    ["TDD-suitable", "borderline", "non-trigger", "holdout"],
  );
  const contract = createTddHarnessEffectContract({
    taskRegistry: registry,
    activationSchemaSha256: "a".repeat(64),
  });
  assert.equal(contract.task_registry_sha256, canonicalJsonDigest(registry));
  assert.equal(contract.opportunity_rules.at(-1)?.expected_opportunity, "eligible");
});

test("typed DSH events project one valid red-green mechanism", () => {
  const result = projectTddMechanism({
    task,
    arm: "treatment",
    events: [
      { seq: 1, type: "skill_loaded", skill_id: "mattpocock-tdd" },
      { seq: 2, type: "file_write", path: "test/public/cancel.test.ts" },
      { seq: 3, type: "test_run", scope: "focused", exit_code: 1 },
      { seq: 4, type: "file_write", path: "src/order-service.ts" },
      { seq: 5, type: "test_run", scope: "focused", exit_code: 0 },
      { seq: 6, type: "test_run", scope: "full", exit_code: 0 },
      { seq: 7, type: "file_write", path: "src/order-service.ts" },
      { seq: 8, type: "test_run", scope: "full", exit_code: 0 },
    ],
  });
  assert.equal(result.activation, "activated");
  assert.equal(result.validity, "valid");
  assert.equal(result.first_test_before_production, true);
  assert.equal(result.focused_red, true);
  assert.equal(result.focused_green, true);
  assert.equal(result.full_suite_green, true);
  assert.equal(result.refactor_after_green, true);
});

test("dependency escape invalidates Harness measurement, not Candidate paths", () => {
  const result = projectTddMechanism({
    task,
    arm: "treatment",
    events: [
      { seq: 1, type: "skill_loaded", skill_id: "mattpocock-tdd" },
      { seq: 2, type: "dependency_request", dependency_id: "codebase-design" },
    ],
  });
  assert.equal(result.validity, "invalid");
  assert.deepEqual(result.reason_codes, ["HARNESS_DEPENDENCY_ESCAPE"]);
});

test("Skill silence is observed rather than treated as infrastructure failure", () => {
  const result = projectTddMechanism({ task, arm: "treatment", events: [] });
  assert.equal(result.activation, "not_activated");
  assert.equal(result.validity, "valid");
});

test("control-arm Skill leakage invalidates Harness measurement", () => {
  const result = projectTddMechanism({
    task,
    arm: "control",
    events: [{ seq: 1, type: "skill_loaded", skill_id: "mattpocock-tdd" }],
  });
  assert.equal(result.validity, "invalid");
  assert.deepEqual(result.reason_codes, ["CONTROL_SKILL_LEAK"]);
});
