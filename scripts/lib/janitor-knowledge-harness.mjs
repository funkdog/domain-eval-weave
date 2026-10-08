import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readStableSessionTranscript } from "../../legacy/dsh-eval-lab/src/carrier/session-inventory.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import {
  checkNativeAuthorizationMetadata,
  cliArgs,
  nativeRuntimePath,
  nativeRuntimePins,
  recordNativeSession,
  validateNativeTranscript,
} from "./codex-coding-harness.mjs";
import { evaluateVerifier, replayVerifier, submitVerifier } from "./janitor-verifier-task.mjs";

const arms = ["raw_sources", "prior_knowledge"];
const envelope = (body) => ({ ...body, digest: canonicalJsonDigest(body) });
const checked = (value) => {
  const { digest, ...body } = value;
  assert.equal(canonicalJsonDigest(body), digest, "artifact digest mismatch");
  return value;
};
const readJson = async (path) =>
  checked(JSON.parse(await readFile(await nativeRuntimePath(path), "utf8")));
const put = (path, value) =>
  writeExclusiveOrVerify(
    path,
    Buffer.from(`${canonicalJson(value)}\n`),
    () => new Error("immutable knowledge episode collision"),
  );
const ownPin = async () => sha256Hex(await readFile(new URL(import.meta.url)));

export async function loadKnowledgeTrial(root) {
  root = await nativeRuntimePath(root);
  const trial = await readJson(join(root, "control/trial.json"));
  assert.equal(trial.format, "janitor-knowledge-trial-v2");
  assert.equal(trial.root, root);
  assert.equal(
    trial.implementation_sha256,
    sha256Hex(await readFile(new URL("./janitor-verifier-task.mjs", import.meta.url))),
  );
  assert.deepEqual(Object.keys(trial.arms).sort(), [...arms].sort());
  for (const arm of Object.values(trial.arms)) await nativeRuntimePath(arm.workspace);
  return trial;
}

// Used both by the native no-model probe and by real launches. No task answers in this config.
export function verifierNativeConfig(workspace, jdk) {
  return {
    model_provider: "openai",
    model: "gpt-5.6-sol",
    model_reasoning_effort: "xhigh",
    approval_policy: "never",
    cli_auth_credentials_store: "file",
    default_permissions: "weave_probe",
    "permissions.weave_probe.filesystem": {
      ":minimal": "read",
      [workspace]: "write",
      [dirname(dirname(process.execPath))]: "read",
      [jdk]: "read",
    },
    "permissions.weave_probe.network.enabled": false,
    web_search: "disabled",
    project_doc_max_bytes: 0,
    "features.shell_tool": true,
    "features.unified_exec": true,
    "features.shell_snapshot": false,
    "features.multi_agent": false,
    "features.apps": false,
    "features.plugins": false,
    "features.hooks": false,
    "features.code_mode_host": true,
    "features.code_mode": false,
    "features.multi_agent_v2": false,
    "features.goals": false,
    "features.sleep_tool": false,
    "features.browser_use": false,
    "features.computer_use": false,
    "features.image_generation": false,
    "features.skip_host_skill_discovery": true,
    "tools.view_image": false,
  };
}

async function initialInputs(trial) {
  for (const name of arms) {
    const receipt = await submitVerifier(trial.root, name); // validates all protected files and links
    const captured = await readJson(
      join(trial.root, "control/submissions", `${receipt.digest}.json`),
    );
    assert.equal(captured.source, trial.baseline_source, "arm already edited");
    assert.equal(captured.information, null, "arm already contains a consumer explanation");
  }
  for (const [path, digest] of Object.entries(trial.common_files))
    for (const arm of Object.values(trial.arms)) assert.equal(arm.protected_files[path], digest);
}

export async function copyVerifierProbeWorkspace(root, destination) {
  const trial = await loadKnowledgeTrial(root);
  await initialInputs(trial);
  const arm = trial.arms.raw_sources;
  for (const path of [...Object.keys(arm.protected_files), "src/JanitorProbe.java"]) {
    assert.ok(path.split("/").every((part) => part && part !== "." && part !== ".."));
    const source = await nativeRuntimePath(join(arm.workspace, path));
    const bytes = await readFile(source);
    assert.equal(sha256Hex(bytes), arm.protected_files[path] ?? sha256Hex(trial.baseline_source));
    await mkdir(dirname(join(destination, path)), { recursive: true, mode: 0o700 });
    await writeFile(join(destination, path), bytes, { flag: "wx", mode: 0o600 });
  }
  return trial;
}

export async function prepareKnowledgePair(root, calibrationPath, preflightRoot, authHome) {
  const trial = await loadKnowledgeTrial(root);
  await initialInputs(trial);
  const calibration = await readJson(calibrationPath);
  assert.equal(calibration.format, "janitor-verifier-calibration-v1");
  assert.equal(calibration.task_digest, trial.digest);
  assert.equal(calibration.passed, true);
  assert.equal(calibration.models_run, 0);
  const proof = await readJson(join(preflightRoot, "launch.json"));
  const preflight = await readJson(join(preflightRoot, "result.json"));
  assert.equal(preflight.launch_digest, proof.digest);
  assert.equal(proof.task_kind, "verifier_author");
  assert.equal(proof.task_digest, trial.digest);
  assert.equal(proof.knowledge_harness_sha256, await ownPin());
  assert.equal(preflight.status, "bounded_native_isolation_verified");
  assert.equal(preflight.real_model_requests, 0);
  assert.equal(
    preflight.public_baseline_execution_observed,
    true,
    "public baseline must actually run before live",
  );
  assert.equal(Object.keys(preflight.gates).length, 13);
  assert.ok(Object.values(preflight.gates).every((v) => v === true));
  const pins = await nativeRuntimePins();
  for (const [key, value] of Object.entries(proof.pins))
    assert.equal(pins[key], value, `preflight drift: ${key}`);
  const base = structuredClone(proof.config);
  for (const key of Object.keys(base))
    if (key.startsWith("model_providers.weave_preflight.")) delete base[key];
  base.model_provider = "openai";
  assert.deepEqual(base, verifierNativeConfig(proof.workspace, trial.environment.java_home));
  const prompt = await readFile(join(trial.arms.raw_sources.workspace, "TASK.md"), "utf8");
  assert.equal(prompt, proof.prompt);
  assert.equal(
    prompt,
    await readFile(join(trial.arms.prior_knowledge.workspace, "TASK.md"), "utf8"),
  );
  authHome = await nativeRuntimePath(authHome);
  await checkNativeAuthorizationMetadata(authHome); // metadata only; native CLI handles authentication
  const firstPairPath = join(root, "control/knowledge-pair.json");
  let previous = null;
  try {
    previous = await readJson(firstPairPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous) {
    assert.equal(previous.format, "weave-knowledge-pair-v1");
    assert.equal(previous.task_digest, trial.digest);
    // A pre-launch correction may append a manifest revision, never mint another attempt slot.
    for (const item of Object.values(previous.launches)) {
      const old = await readJson(item.path);
      assert.equal(old.digest, item.digest);
      assert.equal(old.runRoot, dirname(item.path));
      for (const name of [
        "attempt.json",
        "invocation.json",
        "process.json",
        "consumer-episode.json",
      ])
        await assert.rejects(access(join(old.runRoot, name)), { code: "ENOENT" });
    }
  }
  const launches = {};
  for (const arm of arms) {
    const workspace = trial.arms[arm].workspace;
    const runRoot = previous
      ? dirname(previous.launches[arm].path)
      : await mkdtemp(join(root, "control/verifier-run."));
    const config = verifierNativeConfig(workspace, trial.environment.java_home);
    const manifest = envelope({
      format: "weave-verifier-author-launch-v1",
      runRoot,
      workspace,
      authHome,
      pins,
      taskRoot: root,
      task_digest: trial.digest,
      arm,
      prompt,
      config,
      args: cliArgs(config, prompt),
      harness_sha256: await ownPin(),
      preflight_root: preflightRoot,
      preflight_digest: preflight.digest,
      calibration_path: calibrationPath,
      calibration_digest: calibration.digest,
      budgets: { wall_ms: null, output_bytes: 1024 * 1024 },
      completion_policy: "natural_completion_no_experiment_deadline",
      scope: "one_prior_knowledge_verifier_author_episode",
      qualification: "not_qualified",
    });
    const path = join(runRoot, previous ? `launch.${manifest.digest}.json` : "launch.json");
    await put(path, manifest);
    launches[arm] = { path, digest: manifest.digest };
  }
  const pair = envelope({
    format: "weave-knowledge-pair-v1",
    trial_root: root,
    task_digest: trial.digest,
    launches,
    order: arms,
    model: base.model,
    effort: base.model_reasoning_effort,
    max_model_attempts: 2,
    max_wall_ms_per_arm: null,
    completion_policy: "natural_completion_no_experiment_deadline",
    retries: 0,
    operator_launch_confirmation: "required_before_live",
    independent_content_review: "pending",
    qualification: "not_qualified",
    supersedes_unstarted_pair: previous?.digest ?? null,
  });
  const pairPath = previous
    ? join(root, `control/knowledge-pair.${pair.digest}.json`)
    : firstPairPath;
  await put(pairPath, pair);
  return {
    path: pairPath,
    digest: pair.digest,
    launches,
    models_run: 0,
    qualification: pair.qualification,
  };
}

// On failure, preserve only this launch's newly created Session. Never inspect authentication contents.
async function failedNativeCapture(manifest, error) {
  const evidence = {
    error: String(error.message),
    process: null,
    transcript: null,
    transcript_sha256: null,
  };
  try {
    evidence.process = await readJson(join(manifest.runRoot, "process.json"));
    const invocation = JSON.parse(
      await readFile(join(manifest.runRoot, "invocation.json"), "utf8"),
    );
    assert.equal(invocation.launch_digest, manifest.digest);
    const sessions = join(manifest.authHome, "sessions");
    const files = (await readdir(sessions, { recursive: true }))
      .filter((p) => /^.*rollout-[^/]+\.jsonl$/.test(p))
      .map((p) => join(sessions, p));
    const added = files.filter((p) => !invocation.sessions_before.includes(p));
    assert.equal(
      added.length,
      1,
      "not exactly one new Session; retain native files without attribution",
    );
    const raw = await readStableSessionTranscript(await nativeRuntimePath(added[0]));
    const rows = raw.trim().split("\n").map(JSON.parse);
    const metas = rows.filter((r) => r.type === "session_meta");
    assert.equal(metas.length, 1);
    assert.equal(metas[0].payload.cwd, manifest.workspace);
    evidence.transcript = raw;
    evidence.transcript_sha256 = sha256Hex(raw);
  } catch (captureError) {
    evidence.capture_error = String(captureError.message);
  }
  return evidence;
}

export async function runKnowledgeArm(pairPath, arm, operatorMessageId) {
  // This reference records caller authority, not an identity verifier. The operator must authorize the live action.
  assert.ok(
    typeof operatorMessageId === "string" &&
      operatorMessageId.length > 0 &&
      operatorMessageId.length <= 200 &&
      !/\s/.test(operatorMessageId),
    "explicit operator message reference required",
  );
  assert.ok(arms.includes(arm), "unknown arm");
  const pair = await readJson(pairPath);
  assert.equal(pair.format, "weave-knowledge-pair-v1");
  assert.ok(
    [
      join(pair.trial_root, "control/knowledge-pair.json"),
      join(pair.trial_root, `control/knowledge-pair.${pair.digest}.json`),
    ].includes(pairPath),
    "pair must use its frozen control-side path",
  );
  const trial = await loadKnowledgeTrial(pair.trial_root);
  assert.equal(pair.task_digest, trial.digest);
  const manifest = await readJson(pair.launches[arm].path);
  assert.equal(manifest.digest, pair.launches[arm].digest);
  assert.equal(manifest.format, "weave-verifier-author-launch-v1");
  assert.equal(manifest.runRoot, dirname(pair.launches[arm].path));
  assert.equal(manifest.taskRoot, trial.root);
  assert.equal(manifest.task_digest, trial.digest);
  assert.equal(manifest.arm, arm);
  assert.equal(manifest.workspace, trial.arms[arm].workspace);
  assert.equal(manifest.harness_sha256, await ownPin());
  assert.deepEqual(
    manifest.config,
    verifierNativeConfig(manifest.workspace, trial.environment.java_home),
  );
  assert.deepEqual(manifest.budgets, { wall_ms: null, output_bytes: 1024 * 1024 });
  assert.equal(manifest.completion_policy, "natural_completion_no_experiment_deadline");
  assert.equal(manifest.prompt, await readFile(join(manifest.workspace, "TASK.md"), "utf8"));
  if (arm === arms[1]) {
    const first = await readJson(
      join(dirname(pair.launches[arms[0]].path), "consumer-episode.json"),
    );
    assert.equal(first.launch.digest, pair.launches[arms[0]].digest);
    assert.equal(
      first.native_complete,
      true,
      "first arm incomplete; diagnose before another model request",
    );
    assert.equal(first.artifact_error, null, "first arm artifact collection failed");
    assert.equal(
      first.evaluation?.result.measurement_validity,
      "valid",
      "first arm measurement invalid",
    );
  }
  const initial = await submitVerifier(trial.root, arm);
  const input = await readJson(join(trial.root, "control/submissions", `${initial.digest}.json`));
  assert.equal(input.source, trial.baseline_source);
  assert.equal(input.information, null);
  // Independent of the process recorder's lock: even a failed validation/spawn cannot start a second attempt.
  await writeFile(
    join(manifest.runRoot, "attempt.json"),
    canonicalJson({
      pair_digest: pair.digest,
      launch_digest: manifest.digest,
      operator_message_id: operatorMessageId,
      started: new Date().toISOString(),
    }),
    { flag: "wx", mode: 0o600 },
  );
  let native,
    nativeComplete = false;
  try {
    const recorded = await recordNativeSession(manifest);
    native = {
      process: recorded.processEvidence,
      transcript: recorded.raw,
      transcript_sha256: sha256Hex(recorded.raw),
      session_id: recorded.observed.session_id,
      tool_calls: recorded.observed.calls,
      recorded_model_responses: recorded.observed.recorded_model_responses,
    };
    nativeComplete = true;
  } catch (error) {
    native = await failedNativeCapture(manifest, error);
  }
  await put(join(manifest.runRoot, "native-capture.json"), envelope(native));
  let submission = null,
    evaluation = null,
    artifactError = null;
  try {
    submission = await submitVerifier(trial.root, arm);
    await put(join(manifest.runRoot, "submission-receipt.json"), envelope(submission));
    if (nativeComplete) {
      evaluation = await evaluateVerifier(trial.root, submission.digest);
      assert.deepEqual(await replayVerifier(evaluation.path), evaluation.result);
    }
  } catch (error) {
    artifactError = String(error.message);
  }
  const episode = envelope({
    format: "weave-verifier-author-episode-v1",
    pair_digest: pair.digest,
    launch: manifest,
    operator_message_id: operatorMessageId,
    native_complete: nativeComplete,
    native,
    submission,
    evaluation,
    artifact_error: artifactError,
    source_binding: "captured_after_native_process_group_stop",
    independent_content_review: "pending",
    knowledge_benefit: "not_determined",
    qualification: "not_qualified",
  });
  const path = join(manifest.runRoot, "consumer-episode.json");
  await put(path, episode);
  return {
    path,
    digest: episode.digest,
    native_complete: nativeComplete,
    artifact_error: artifactError,
    evaluation: evaluation?.result ?? null,
    qualification: "not_qualified",
  };
}

export async function replayKnowledgeEpisode(path) {
  const episode = await readJson(path);
  assert.equal(episode.format, "weave-verifier-author-episode-v1");
  checked(episode.launch);
  const native = episode.native;
  if (native.transcript !== null)
    assert.equal(sha256Hex(native.transcript), native.transcript_sha256);
  if (episode.native_complete) {
    const observed = validateNativeTranscript(
      native.transcript,
      native.process.stdout,
      episode.launch,
    );
    assert.equal(observed.session_id, native.session_id);
    assert.equal(observed.calls, native.tool_calls);
  }
  if (episode.evaluation) {
    const run = await readJson(episode.evaluation.path);
    assert.equal(run.candidate.digest, episode.submission.digest);
    assert.equal(run.candidate.arm, episode.launch.arm);
    assert.equal(run.task.digest, episode.launch.task_digest);
    assert.deepEqual(await replayVerifier(episode.evaluation.path), episode.evaluation.result);
  }
  return {
    native_complete: episode.native_complete,
    evaluation: episode.evaluation?.result ?? null,
    artifact_error: episode.artifact_error,
    qualification: "not_qualified",
    model_requests: 0,
  };
}
