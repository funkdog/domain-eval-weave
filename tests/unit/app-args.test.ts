import assert from "node:assert/strict";
import test from "node:test";

import { AppUsageError, EXIT_CODE, parseAppArguments } from "../../src/app/args.js";
import { DefaultAppExecutor } from "../../src/app/default-executor.js";

test("app grammar normalizes Phase 1 compatibility, Phase 2, and Phase 3A commands", () => {
  assert.deepEqual(parseAppArguments([]), { kind: "help" });
  assert.deepEqual(parseAppArguments(["--help"]), { kind: "help" });
  assert.deepEqual(parseAppArguments(["--version"]), { kind: "version" });
  assert.deepEqual(parseAppArguments(["init"]), { kind: "init" });
  assert.deepEqual(parseAppArguments(["auth", "status"]), { kind: "auth-status" });
  assert.deepEqual(parseAppArguments(["auth", "login"]), { kind: "auth-login" });
  assert.deepEqual(parseAppArguments(["doctor"]), { kind: "doctor" });
  assert.deepEqual(parseAppArguments(["calibrate"]), { kind: "calibrate" });
  assert.deepEqual(parseAppArguments(["run"]), {
    kind: "run",
    timeoutMs: 2_700_000,
    keepWorkspaces: true,
  });
  assert.deepEqual(parseAppArguments(["run", "--keep-workspaces", "--timeout-ms", "5400000"]), {
    kind: "run",
    timeoutMs: 5_400_000,
    keepWorkspaces: true,
  });
  assert.deepEqual(parseAppArguments(["report", "campaign-m0"]), {
    kind: "report",
    campaignId: "campaign-m0",
  });
  assert.deepEqual(parseAppArguments(["binding", "show"]), { kind: "binding-show" });
  assert.deepEqual(parseAppArguments(["suite", "run"]), {
    kind: "suite-run",
    timeoutMs: 2_700_000,
  });
  assert.deepEqual(parseAppArguments(["suite", "run", "--timeout-ms", "5400000"]), {
    kind: "suite-run",
    timeoutMs: 5_400_000,
  });
  assert.deepEqual(parseAppArguments(["suite", "report", "suite-phase2"]), {
    kind: "suite-report",
    suiteId: "suite-phase2",
  });
  assert.deepEqual(
    parseAppArguments([
      "domain",
      "validate",
      "domain-eval",
      "manifests/snapshot-synthetic-commerce-v1.json",
    ]),
    {
      kind: "domain-validate",
      packPath: "domain-eval",
      manifestPath: "manifests/snapshot-synthetic-commerce-v1.json",
    },
  );
  assert.deepEqual(
    parseAppArguments([
      "delivery",
      "run",
      "domain-eval",
      "manifests/reservation-v1.json",
      "implement-reservation-ledger",
    ]),
    {
      kind: "delivery-run",
      packPath: "domain-eval",
      manifestPath: "manifests/reservation-v1.json",
      requirementId: "implement-reservation-ledger",
      timeoutMs: 2_700_000,
    },
  );
  assert.deepEqual(
    parseAppArguments([
      "delivery",
      "run",
      "domain-eval",
      "manifests/reservation-v1.json",
      "implement-reservation-ledger",
      "--timeout-ms",
      "5400000",
    ]),
    {
      kind: "delivery-run",
      packPath: "domain-eval",
      manifestPath: "manifests/reservation-v1.json",
      requirementId: "implement-reservation-ledger",
      timeoutMs: 5_400_000,
    },
  );
  assert.deepEqual(parseAppArguments(["delivery", "report", "campaign-phase3b"]), {
    kind: "delivery-report",
    campaignId: "campaign-phase3b",
  });
  assert.deepEqual(
    parseAppArguments([
      "domain",
      "impact",
      "domain-eval",
      "manifests/snapshot-synthetic-commerce-v1.json",
      "refund-cash-limit",
    ]),
    {
      kind: "domain-impact",
      packPath: "domain-eval",
      manifestPath: "manifests/snapshot-synthetic-commerce-v1.json",
      claimId: "refund-cash-limit",
    },
  );
  assert.deepEqual(
    parseAppArguments([
      "domain",
      "confirm",
      "domain-eval",
      "evidence_card",
      "candidates/card.json",
      "domain-owner-commerce",
    ]),
    {
      kind: "domain-authority",
      packPath: "domain-eval",
      targetKind: "evidence_card",
      candidatePath: "candidates/card.json",
      actorId: "domain-owner-commerce",
    },
  );
});

test("artifact-only report failures use the frozen integrity exit family", async () => {
  let stderr = "";
  const executor = new DefaultAppExecutor({ stderr: (text) => (stderr += text) });
  assert.equal(
    await executor.execute({ kind: "report", campaignId: "campaign-that-does-not-exist" }),
    EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE,
  );
  assert.equal(
    await executor.execute({
      kind: "delivery-report",
      campaignId: "campaign-that-does-not-exist",
    }),
    EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE,
  );
  assert.match(stderr, /ARTIFACT_INTEGRITY_FAILURE/);
});

test("usage failures use the stable exit code and reject runtime-root overrides", () => {
  const invalid = [
    ["unknown"],
    ["init", "extra"],
    ["auth"],
    ["auth", "unknown"],
    ["report"],
    ["report", "../campaign"],
    ["binding"],
    ["binding", "unknown"],
    ["suite"],
    ["suite", "unknown"],
    ["suite", "report"],
    ["suite", "report", "../suite"],
    ["suite", "run", "--keep-workspaces"],
    ["suite", "run", "--runtime-root", "/tmp/elsewhere"],
    ["suite", "run", "--timeout-ms", "0"],
    ["suite", "run", "--timeout-ms", "5400001"],
    ["domain"],
    ["domain", "validate"],
    ["domain", "validate", "../domain-eval"],
    ["domain", "validate", "/tmp/domain-eval"],
    ["domain", "impact", "domain-eval"],
    ["domain", "impact", "domain-eval", "manifests/a.json", "../claim"],
    ["domain", "reject", "domain-eval", "evidence_card", "candidates/a.json", "owner"],
    ["domain", "withdraw", "domain-eval", "requirement_change_set", "candidates/a.json", "owner"],
    ["domain", "confirm", "domain-eval", "claim_transition", "candidates/a.json", "owner"],
    ["delivery"],
    ["delivery", "run"],
    ["delivery", "run", "domain-eval", "manifests/a.json", "../requirement"],
    [
      "delivery",
      "run",
      "domain-eval",
      "manifests/a.json",
      "requirement",
      "--timeout-ms",
      "5400001",
    ],
    ["delivery", "report", "../campaign"],
    ["run", "--runtime-root", "/tmp/elsewhere"],
    ["run", "--timeout-ms", "0"],
    ["run", "--timeout-ms", "5400001"],
    ["run", "--timeout-ms", "100", "--timeout-ms", "200"],
    ["run", "--keep-workspaces", "--keep-workspaces"],
  ] as const;

  for (const args of invalid) {
    assert.throws(
      () => parseAppArguments(args),
      (error: unknown) =>
        error instanceof AppUsageError && error.exitCode === EXIT_CODE.USAGE_OR_CONTRACT,
      args.join(" "),
    );
  }
});
