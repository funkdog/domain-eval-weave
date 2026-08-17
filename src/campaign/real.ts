import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { parse } from "yaml";

import { DshRunCarrier } from "../carrier/dsh-run.js";
import { discoverFreshSession } from "../carrier/session-discovery.js";
import {
  type LocatedSessionInventoryEntry,
  readStableSessionTranscript,
  scanRawSessionInventory,
} from "../carrier/session-inventory.js";
import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";
import { parseExperimentSpec, parseVariantSpec, type VariantSpec } from "../contracts/parsers.js";
import {
  findPackageRoot,
  fingerprintPackageClosure,
  fingerprintPackageContent,
} from "../fingerprint/deployment.js";
import {
  assertExactGoalIntervention,
  type ComposedRow,
  fingerprintComposedRows,
} from "../fingerprint/variants.js";
import { computeCandidateTree, freezeCandidate } from "../freeze/candidate.js";
import { type BehaviorVector, LEDGER_BEHAVIORS, LedgerOracle } from "../oracle/ledger.js";
import { StrictProcessRunner } from "../process/strict-runner.js";
import { decodeOfficialSessionJsonl } from "../projector/jsonl.js";
import { projectSessionEvidence, type SessionProjection } from "../projector/projector.js";
import { assertProfileRoles } from "../runtime-profile/init.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../runtime-root.js";
import { digestTaskPack, loadTaskPack, loadTaskPackIdentity } from "../task-pack/loader.js";
import { evaluationFromEvidence } from "../validity/evaluation.js";
import {
  type ArmEvaluationOutput,
  type ArmExecutionOutput,
  type CampaignPointers,
  runPairedCampaign,
} from "./coordinator.js";

const execFileAsync = promisify(execFile);
const DSH_JS_YAML_TAG = {
  tag: "tag:yaml.org,2002:js",
  resolve: (value: string) => value,
};

interface RealArmOracleInput {
  readonly projection: SessionProjection;
  readonly archivePath: string;
  readonly candidateAuthorized: boolean;
  readonly elapsedMs: number;
  readonly workspace: string;
  readonly frozenTree: string;
  readonly deploymentFingerprintMatches: boolean;
  readonly goalExpected: boolean;
  readonly carrierProcessHealthy: boolean;
}

export class CarrierQualificationError extends Error {
  readonly code = "CARRIER_QUALIFICATION_FAILED";

  constructor() {
    super("headless carrier qualification failed");
    this.name = "CarrierQualificationError";
  }
}

export function dshLaunch(): { executable: string; launcherArgs: readonly string[] } {
  const script = process.argv[1];
  if (script === undefined) throw new Error("DSH launcher script is unavailable");
  return { executable: process.execPath, launcherArgs: [script] };
}

export async function dumpRows(
  launch: ReturnType<typeof dshLaunch>,
  commonPatch: string,
  armPatch: string,
): Promise<readonly ComposedRow[]> {
  return dumpProfileRows(launch, "eval-runner", [commonPatch, armPatch]);
}

export async function dumpProfileRows(
  launch: ReturnType<typeof dshLaunch>,
  profile: "eval" | "eval-runner",
  patches: readonly string[],
): Promise<readonly ComposedRow[]> {
  const result = await execFileAsync(
    launch.executable,
    [
      ...launch.launcherArgs,
      "--profile",
      profile,
      ...patches.flatMap((patch) => ["--patch", patch]),
      "--dump-config",
    ],
    {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        DSH_HOME: DEDICATED_DSH_HOME,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const decoded = parse(result.stdout, { customTags: [DSH_JS_YAML_TAG] });
  if (!Array.isArray(decoded)) throw new Error("DSH config dump is not a row array");
  return decoded as ComposedRow[];
}

export async function initializeGitWorkspace(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  await chmod(destination, 0o700);
  const run = (args: readonly string[]) =>
    execFileAsync("git", [...args], {
      cwd: destination,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
  await run(["init", "-q"]);
  await run(["config", "user.email", "eval-fixture@example.invalid"]);
  await run(["config", "user.name", "DSH Eval Fixture"]);
  await run(["add", "."]);
  await run(["commit", "-qm", "frozen task base"]);
}

export function createOpaqueArmWorkspaces(campaignId: string): {
  readonly control: string;
  readonly treatment: string;
} {
  return {
    control: `${DEDICATED_RUNTIME_ROOT}/workspaces/${campaignId}/episode-${randomUUID()}`,
    treatment: `${DEDICATED_RUNTIME_ROOT}/workspaces/${campaignId}/episode-${randomUUID()}`,
  };
}

function locatedSession(
  inventory: readonly LocatedSessionInventoryEntry[],
  id: string,
): LocatedSessionInventoryEntry {
  const match = inventory.find((entry) => entry.id === id);
  if (match === undefined) throw new Error("discovered Session transcript is missing");
  return match;
}

async function writeFrozenQualification(path: string, value: unknown): Promise<void> {
  const bytes = `${canonicalJson(value)}\n`;
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== bytes) throw new Error("qualification artifact drift");
  }
}

async function qualifyCarrier(input: {
  readonly launch: ReturnType<typeof dshLaunch>;
  readonly packageRoot: string;
  readonly commonPatch: string;
  readonly controlPatch: string;
  readonly deploymentDigest: string;
}): Promise<{ readonly commonToolSchemaSha256: string }> {
  const qualificationPath = `${DEDICATED_RUNTIME_ROOT}/qualification/${input.deploymentDigest}.json`;
  try {
    const existing = JSON.parse(await readFile(qualificationPath, "utf8")) as {
      ready?: unknown;
      common_tool_schema_sha256?: unknown;
    };
    if (
      existing.ready === true &&
      typeof existing.common_tool_schema_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(existing.common_tool_schema_sha256)
    ) {
      return { commonToolSchemaSha256: existing.common_tool_schema_sha256 };
    }
    throw new Error("qualification artifact is not ready");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const workspace = `${DEDICATED_RUNTIME_ROOT}/workspaces/qualification-${randomUUID()}`;
  await initializeGitWorkspace(
    `${input.packageRoot}/task-packs/open-coding-ts-ledger-v1/base`,
    workspace,
  );
  const sessionsRoot = `${DEDICATED_DSH_HOME}/sessions`;
  const before = await scanRawSessionInventory(sessionsRoot);
  const startedAt = new Date().toISOString();
  const carrier = new DshRunCarrier();
  const result = await carrier.runEpisode({
    ...input.launch,
    workspace,
    commonPatch: input.commonPatch,
    armPatch: input.controlPatch,
    task: "Use workspace tools to read SMOKE.txt, then answer exactly DSH_EVAL_CARRIER_OK.",
    timeoutMs: 300_000,
  });
  const endedAt = new Date().toISOString();
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputLimitExceeded ||
    result.stdout.trim() !== "DSH_EVAL_CARRIER_OK"
  ) {
    throw new Error("headless carrier qualification process failed");
  }
  const after = await scanRawSessionInventory(sessionsRoot);
  const discovered = discoverFreshSession({ before, after, workspace, startedAt, endedAt });
  const transcript = await readStableSessionTranscript(
    locatedSession(after, discovered.id).transcriptPath,
  );
  const decoded = decodeOfficialSessionJsonl(transcript);
  const required = new Set(decoded.events.map((event) => event.type));
  for (const eventType of [
    "request/header",
    "request/context",
    "tool/call",
    "tool/result",
    "assistant/message",
    "turn/end",
  ]) {
    if (!required.has(eventType)) throw new Error("qualification Session evidence is incomplete");
  }
  const projection = projectSessionEvidence(decoded);
  if (projection.measurement_validity.overall === "invalid") {
    throw new Error("qualification Session projection is invalid");
  }
  const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: workspace });
  if (status.stdout !== "") throw new Error("qualification modified its read-only workspace");
  await writeFrozenQualification(qualificationPath, {
    schema_version: 1,
    ready: true,
    deployment_digest: input.deploymentDigest,
    session_id: discovered.id,
    common_tool_schema_sha256: projection.deployment.common_tool_schema_sha256,
  });
  return { commonToolSchemaSha256: projection.deployment.common_tool_schema_sha256 };
}

function errorVector(): BehaviorVector {
  return Object.fromEntries(
    LEDGER_BEHAVIORS.map((behavior) => [behavior, "error"]),
  ) as BehaviorVector;
}

export async function runRealCampaign(input: {
  readonly packageRoot: string;
  readonly timeoutMs: number;
  readonly confirm: (summary: string) => Promise<boolean>;
}): Promise<{ readonly campaignId: string; readonly pointers: CampaignPointers }> {
  const packRoot = `${input.packageRoot}/task-packs/open-coding-ts-ledger-v1`;
  const pack = await loadTaskPack(packRoot);
  const taskPackIdentity = await loadTaskPackIdentity(packRoot);
  const taskPackDigest = await digestTaskPack(packRoot);
  const commonPatch = `${input.packageRoot}/variants/common.patch.yml`;
  const controlPatch = `${input.packageRoot}/variants/goal-off.patch.yml`;
  const treatmentPatch = `${input.packageRoot}/variants/goal-on.patch.yml`;
  const launch = dshLaunch();
  const [controlRows, treatmentRows, task] = await Promise.all([
    dumpRows(launch, commonPatch, controlPatch),
    dumpRows(launch, commonPatch, treatmentPatch),
    readFile(`${packRoot}/${pack.public_task_ref}`, "utf8"),
  ]);
  assertProfileRoles(controlRows, "runner");
  assertProfileRoles(treatmentRows, "runner");
  assertExactGoalIntervention(controlRows, treatmentRows);
  const controlConfigDigest = fingerprintComposedRows(controlRows);
  const treatmentConfigDigest = fingerprintComposedRows(treatmentRows);
  const [commonPatchBytes, controlPatchBytes, treatmentPatchBytes, dshRoot] = await Promise.all([
    readFile(commonPatch),
    readFile(controlPatch),
    readFile(treatmentPatch),
    findPackageRoot(launch.launcherArgs[0] ?? "", "@deepseek-ai/dsh"),
  ]);
  const codexConnectRoot = `${DEDICATED_DSH_HOME}/profiles/eval-runner/node_modules/dsh-codex-connect`;
  const [dshPackageTreeDigest, codexConnectDigest, evalPackageDigest] = await Promise.all([
    fingerprintPackageClosure(dshRoot),
    fingerprintPackageContent(codexConnectRoot),
    fingerprintPackageContent(input.packageRoot),
  ]);
  const deploymentDigest = sha256Hex(
    canonicalJson({
      control: controlConfigDigest,
      treatment: treatmentConfigDigest,
      task_pack: taskPackDigest,
      model: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "xhigh" },
      dsh_package_tree: dshPackageTreeDigest,
      codex_connect_package: codexConnectDigest,
      eval_package: evalPackageDigest,
      common_patch: sha256Hex(commonPatchBytes),
    }),
  );
  const confirmed = await input.confirm(
    `Run one read-only qualification if needed and two model Episodes (max ${input.timeoutMs} ms per arm)?`,
  );
  if (!confirmed) throw new Error("Campaign confirmation declined");
  let qualification: Awaited<ReturnType<typeof qualifyCarrier>>;
  try {
    qualification = await qualifyCarrier({
      launch,
      packageRoot: input.packageRoot,
      commonPatch,
      controlPatch,
      deploymentDigest,
    });
  } catch {
    throw new CarrierQualificationError();
  }
  const variant = (
    variantId: "goal-off" | "goal-on",
    armPatchSha256: string,
    resolvedConfigSha256: string,
    enabled: boolean,
  ): VariantSpec =>
    parseVariantSpec({
      schema_version: 1,
      variant_id: variantId,
      common_patch_sha256: sha256Hex(commonPatchBytes),
      arm_patch_sha256: armPatchSha256,
      expected_goal_rows: {
        goal: enabled,
        goal_round_driver: enabled,
        command_goal: enabled,
        tool_goal: enabled,
      },
      dsh_package_tree_sha256: dshPackageTreeDigest,
      codex_connect_package_sha256: codexConnectDigest,
      model_route: {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        reasoning_effort: "xhigh",
      },
      resolved_config_sha256: resolvedConfigSha256,
      tool_schema_sha256: qualification.commonToolSchemaSha256,
      tools_mode: "native",
      permission_mode: "workspace-write",
    });
  const variants = {
    control: variant("goal-off", sha256Hex(controlPatchBytes), controlConfigDigest, false),
    treatment: variant("goal-on", sha256Hex(treatmentPatchBytes), treatmentConfigDigest, true),
  } as const;
  const controlDigest = sha256Hex(canonicalJson(variants.control));
  const treatmentDigest = sha256Hex(canonicalJson(variants.treatment));

  const campaignId = `campaign-${new Date()
    .toISOString()
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const armOrder = randomInt(2) === 0 ? ["control", "treatment"] : ["treatment", "control"];
  const experiment = parseExperimentSpec({
    schema_version: 1,
    campaign_id: campaignId,
    created_at: new Date().toISOString(),
    domain: "open-coding-delivery",
    eval_pack_id: "open-coding-delivery-v1",
    task_pack_digest: taskPackDigest,
    control_variant_digest: controlDigest,
    treatment_variant_digest: treatmentDigest,
    intervention: {
      id: "dsh-goal-stack",
      allowed_config_paths: [
        "goal.disabled",
        "goal-round-driver.disabled",
        "command-goal.disabled",
        "tool-goal.disabled",
      ],
    },
    arm_order: armOrder,
    timeout_ms_per_arm: input.timeoutMs,
    claim_strength: "diagnostic",
    effect_claim_eligible: false,
  });
  const campaignRoot = `${DEDICATED_RUNTIME_ROOT}/campaigns/${campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  const workspaces = createOpaqueArmWorkspaces(campaignId);
  await Promise.all([
    initializeGitWorkspace(`${packRoot}/base`, workspaces.control),
    initializeGitWorkspace(`${packRoot}/base`, workspaces.treatment),
  ]);
  const carrier = new DshRunCarrier();
  let oracleSeed: number | undefined;
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
  });
  const result = await runPairedCampaign({
    campaignRoot,
    experiment,
    variants,
    taskPackIdentity,
    executeArm: async (arm): Promise<ArmExecutionOutput> => {
      const workspace = workspaces[arm];
      const before = await scanRawSessionInventory(`${DEDICATED_DSH_HOME}/sessions`);
      const startedAt = new Date().toISOString();
      const monotonicStart = performance.now();
      const processResult = await carrier.runEpisode({
        ...launch,
        workspace,
        commonPatch,
        armPatch: arm === "control" ? controlPatch : treatmentPatch,
        task,
        timeoutMs: input.timeoutMs,
      });
      const elapsedMs = Math.max(0, Math.round(performance.now() - monotonicStart));
      const endedAt = new Date().toISOString();
      if (processResult.timedOut || processResult.outputLimitExceeded) {
        throw new Error("arm exceeded a process boundary before trustworthy freeze");
      }
      const after = await scanRawSessionInventory(`${DEDICATED_DSH_HOME}/sessions`);
      const discovered = discoverFreshSession({ before, after, workspace, startedAt, endedAt });
      const transcriptPath = locatedSession(after, discovered.id).transcriptPath;
      const transcript = await readStableSessionTranscript(transcriptPath);
      const projection = projectSessionEvidence(decodeOfficialSessionJsonl(transcript));
      const expectedVariant = variants[arm];
      const goalTools = new Set(["get_goal", "create_goal", "update_goal"]);
      const presentGoalTools = projection.deployment.tool_names.filter((name) =>
        goalTools.has(name),
      );
      const goalSurfaceMatches =
        arm === "control"
          ? presentGoalTools.length === 0
          : presentGoalTools.length === goalTools.size;
      const deploymentFingerprintMatches =
        projection.deployment.common_tool_schema_sha256 === expectedVariant.tool_schema_sha256 &&
        goalSurfaceMatches;
      const frozen = await freezeCandidate({
        workspace,
        artifactRoot: `${campaignRoot}/arms/${arm}`,
      });
      return {
        sessionId: discovered.id,
        sessionLog: transcript,
        candidateTree: frozen.tree,
        candidateArchive: await readFile(frozen.archivePath),
        workspaceBaseDigest: pack.base_tree_sha256,
        process: {
          started_at: startedAt,
          ended_at: endedAt,
          exit_code: processResult.exitCode,
          signal: processResult.signal,
          timed_out: processResult.timedOut,
        },
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        oracleInput: {
          projection,
          archivePath: frozen.archivePath,
          candidateAuthorized: frozen.authorized,
          elapsedMs,
          workspace,
          frozenTree: frozen.tree,
          deploymentFingerprintMatches,
          goalExpected: arm === "treatment",
          carrierProcessHealthy: processResult.exitCode === 0 && processResult.signal === null,
        } satisfies RealArmOracleInput,
      };
    },
    evaluateArm: async (_arm, output): Promise<ArmEvaluationOutput> => {
      const oracleInput = output.oracleInput as RealArmOracleInput;
      oracleSeed ??= randomInt(0, 2_147_483_647);
      const scratchParent = `${DEDICATED_RUNTIME_ROOT}/oracle-tmp`;
      await mkdir(scratchParent, { recursive: true, mode: 0o700 });
      const scratch = await mkdtemp(`${scratchParent}/oracle-${randomUUID()}-`);
      let behavior: BehaviorVector;
      try {
        behavior = oracleInput.candidateAuthorized
          ? await oracle.evaluateArchive(oracleInput.archivePath, oracleSeed, scratch)
          : errorVector();
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
      const candidateUnchangedAfterOracle =
        (await computeCandidateTree(
          oracleInput.workspace,
          `${DEDICATED_RUNTIME_ROOT}/oracle-tmp/tree-verification`,
        )) === oracleInput.frozenTree;
      const result = evaluationFromEvidence({
        projection: oracleInput.projection,
        behavior,
        candidateAuthorized: oracleInput.candidateAuthorized,
        oracleHidden: true,
        candidateFrozenBeforeOracle: true,
        candidateUnchangedAfterOracle,
        deploymentFingerprintMatches: oracleInput.deploymentFingerprintMatches,
        goalExpected: oracleInput.goalExpected,
        carrierProcessHealthy: oracleInput.carrierProcessHealthy,
        elapsedMs: oracleInput.elapsedMs,
      });
      return {
        result,
        behavior,
        oracleSeed: {
          schema_version: 1,
          seed: oracleSeed,
          oracle_version: pack.oracle_version,
        },
      };
    },
  });
  return { campaignId, pointers: result.pointers };
}
