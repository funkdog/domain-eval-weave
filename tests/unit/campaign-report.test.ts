import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import { CampaignStateError, CampaignStateStore } from "../../src/campaign/state.js";
import { parsePairedImpactReport } from "../../src/contracts/parsers.js";
import { recommendAction, renderPairedReportMarkdown } from "../../src/report/reporter.js";
import { assertSecretFreeText, SecretScanError } from "../../src/report/secret-scan.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { validReport } from "../helpers/fixtures.js";

test("Campaign state transitions are durable, ordered, and interruption-safe", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/campaign-state-`);
  const store = new CampaignStateStore(`${root}/state.json`);
  try {
    await store.initialize("campaign-state");
    await store.transition("qualified");
    await store.transition("arm_1_running");
    assert.equal((await store.recoverAfterCrash()).phase, "interrupted");
    await assert.rejects(store.transition("reported"), CampaignStateError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recommendations are deterministic across the frozen result combinations", () => {
  const base = {
    validity: "valid" as const,
    controlPassed: true,
    treatmentPassed: true,
    treatmentGoalActivated: true,
    treatmentCostHigher: false,
  };
  assert.equal(recommendAction({ ...base, validity: "invalid" }), "run_more");
  assert.equal(recommendAction({ ...base, treatmentGoalActivated: false }), "iterate");
  assert.equal(
    recommendAction({ ...base, validity: "insufficient", treatmentGoalActivated: false }),
    "iterate",
  );
  assert.equal(recommendAction({ ...base, validity: "insufficient" }), "run_more");
  assert.equal(recommendAction({ ...base, treatmentPassed: false }), "revert");
  assert.equal(
    recommendAction({ ...base, controlPassed: false, treatmentPassed: true }),
    "run_more",
  );
  assert.equal(
    recommendAction({ ...base, controlPassed: false, treatmentPassed: false }),
    "iterate",
  );
  assert.equal(recommendAction({ ...base, treatmentCostHigher: true }), "keep_baseline");
  assert.equal(recommendAction(base), "keep");
});

test("Markdown report exposes Outcome, Mechanism, Cost, Validity, and bounded actions", () => {
  const markdown = renderPairedReportMarkdown(parsePairedImpactReport(validReport));
  for (const heading of [
    "Validity",
    "Outcome",
    "Mechanism",
    "Cost",
    "Hard gates",
    "Blind spots",
    "Next action",
  ]) {
    assert.match(markdown, new RegExp(`## ${heading}`));
  }
  assert.equal(/overall uplift|statistically significant/i.test(markdown), false);
  assert.match(markdown, /diagnostic/);
  assert.match(markdown, /effect claim eligible: no/i);
});

test("report scanner fails closed on OAuth and credential-shaped output", () => {
  assert.doesNotThrow(() => assertSecretFreeText("diagnostic report without secrets"));
  assert.throws(() => assertSecretFreeText("access_token=synthetic"), SecretScanError);
  assert.throws(() => assertSecretFreeText('{"id_token":"synthetic"}'), SecretScanError);
  assert.throws(() => assertSecretFreeText('{"oauthToken":"synthetic"}'), SecretScanError);
  assert.throws(() => assertSecretFreeText('{"authToken":"synthetic"}'), SecretScanError);
  assert.throws(() => assertSecretFreeText('{"apiToken":"synthetic"}'), SecretScanError);
  assert.throws(() => assertSecretFreeText('{"userAuthToken":"synthetic"}'), SecretScanError);
  assert.throws(() => assertSecretFreeText('{"serviceApiToken":"synthetic"}'), SecretScanError);
  assert.throws(() => assertSecretFreeText("X-Service-Auth-Token: synthetic"), SecretScanError);
  assert.throws(() => assertSecretFreeText("oauth_token_secret=synthetic"), SecretScanError);
  assert.throws(() => assertSecretFreeText("consumerSecret=synthetic"), SecretScanError);
  assert.throws(() => assertSecretFreeText("authorizationCode=synthetic"), SecretScanError);
  assert.throws(() => assertSecretFreeText("client_secret=synthetic"), SecretScanError);
  assert.throws(() => assertSecretFreeText("-----BEGIN PRIVATE KEY-----"), SecretScanError);
  assert.throws(
    () => assertSecretFreeText("https://example.invalid/oauth/device"),
    SecretScanError,
  );
});
