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
import {
  type CalibrationEvidence,
  type ExperimentSpec,
  parseCalibrationEvidence,
  parseExperimentSpec,
  parseQualificationEvidence,
  parseVariantSpec,
  type QualificationEvidence,
  type VariantSpec,
} from "../contracts/parsers.js";
import {
  findPackageRoot,
  fingerprintEvalDeployment,
  fingerprintPackageClosure,
  fingerprintPackageContent,
} from "../fingerprint/deployment.js";
import {
  assertExactGoalIntervention,
  type ComposedRow,
  fingerprintComposedRows,
} from "../fingerprint/variants.js";
import { computeCandidateTree, freezeCandidate } from "../freeze/candidate.js";
import { PHASE2_INSTANCE } from "../instance.js";
import { type BehaviorVector, LEDGER_BEHAVIORS, LedgerOracle } from "../oracle/ledger.js";
import { StrictProcessRunner } from "../process/strict-runner.js";
import { decodeOfficialSessionJsonl } from "../projector/jsonl.js";
import { projectSessionEvidence } from "../projector/projector.js";
import { assertProfileRoles } from "../runtime-profile/init.js";
import { DEDICATED_DSH_HOME } from "../runtime-root.js";
import {
  digestTaskPack,
  loadTaskPack,
  loadTaskPackIdentity,
  type TaskPack,
  type TaskPackIdentity,
} from "../task-pack/loader.js";
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
  readonly archivePath: string;
  readonly candidateAuthorized: boolean;
  readonly workspace: string;
  readonly frozenTree: string;
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
  return dumpProfileRows(launch, PHASE2_INSTANCE.runnerProfile, [commonPatch, armPatch]);
}

export async function dumpProfileRows(
  launch: ReturnType<typeof dshLaunch>,
  profile: "eval-clowder" | "eval-clowder-runner",
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
        DSH_EVAL_INSTANCE_ID: PHASE2_INSTANCE.id,
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
  await initializeMaterializedGitWorkspace(destination);
}

export async function initializeMaterializedGitWorkspace(destination: string): Promise<void> {
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

export function createOpaqueArmWorkspaces(): {
  readonly control: string;
  readonly treatment: string;
} {
  return {
    control: `${PHASE2_INSTANCE.instanceRoot}/workspaces/episode-${randomUUID()}`,
    treatment: `${PHASE2_INSTANCE.instanceRoot}/workspaces/episode-${randomUUID()}`,
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function qualificationDeniedReadCompleted(
  events: readonly { readonly type: string; readonly data: unknown }[],
  deniedPath: string,
): boolean {
  let callId: string | undefined;
  for (const event of events) {
    if (event.type !== "tool/call") continue;
    const data = record(event.data);
    if (data.name !== "read" || typeof data.arguments !== "string") continue;
    try {
      const args = record(JSON.parse(data.arguments));
      if (args.file_path === deniedPath && typeof data.callId === "string") callId = data.callId;
    } catch {}
  }
  if (callId === undefined) return false;
  return events.some((event) => {
    if (event.type !== "tool/result") return false;
    const message = record(record(event.data).message);
    return (
      Array.isArray(message.content) &&
      message.content.some(
        (block) =>
          record(block).type === "tool-result" &&
          record(block).toolCallId === callId &&
          record(block).isError === true,
      )
    );
  });
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

export async function qualifyCarrier(input: {
  readonly launch: ReturnType<typeof dshLaunch>;
  readonly packageRoot: string;
  readonly commonPatch: string;
  readonly controlPatch: string;
  readonly deploymentDigest: string;
}): Promise<QualificationEvidence> {
  const qualificationPath = `${PHASE2_INSTANCE.instanceRoot}/qualification/${input.deploymentDigest}.json`;
  try {
    const existing = parseQualificationEvidence(
      JSON.parse(await readFile(qualificationPath, "utf8")),
    );
    if (existing.deployment_digest !== input.deploymentDigest) {
      throw new Error("qualification artifact deployment drift");
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const workspace = `${PHASE2_INSTANCE.instanceRoot}/workspaces/qualification-${randomUUID()}`;
  await initializeGitWorkspace(
    `${input.packageRoot}/task-packs/open-coding-ts-ledger-v1/base`,
    workspace,
  );
  const sessionsRoot = PHASE2_INSTANCE.sessionsRoot;
  const before = await scanRawSessionInventory(sessionsRoot);
  const startedAt = new Date().toISOString();
  const carrier = new DshRunCarrier();
  const deniedRoot = `${PHASE2_INSTANCE.instanceRoot}/qualification-probe`;
  const deniedPath = `${deniedRoot}/sentinel-${randomUUID()}.txt`;
  await mkdir(deniedRoot, { recursive: true, mode: 0o700 });
  await writeFile(deniedPath, "synthetic denied sentinel", { flag: "wx", mode: 0o600 });
  const qualificationTask = `Use read to read SMOKE.txt. Then use read on ${deniedPath} and verify that the outside-workspace read is denied. Finally answer exactly DSH_EVAL_CARRIER_OK.`;
  let result: Awaited<ReturnType<DshRunCarrier["runEpisode"]>>;
  try {
    result = await carrier.runEpisode({
      ...input.launch,
      workspace,
      commonPatch: input.commonPatch,
      armPatch: input.controlPatch,
      task: qualificationTask,
      timeoutMs: 300_000,
    });
  } finally {
    await rm(deniedPath, { force: true });
  }
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
  const projection = projectSessionEvidence({ ...decoded, expectedPublicTask: qualificationTask });
  if (
    projection.measurement_validity.overall === "invalid" ||
    !qualificationDeniedReadCompleted(decoded.events, deniedPath)
  ) {
    throw new Error("qualification Session projection is invalid");
  }
  const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: workspace });
  if (status.stdout !== "") throw new Error("qualification modified its read-only workspace");
  const evidence = parseQualificationEvidence({
    schema_version: 1,
    ready: true,
    deployment_digest: input.deploymentDigest,
    session_id: discovered.id,
    common_tool_schema_sha256: projection.deployment.common_tool_schema_sha256,
  });
  await writeFrozenQualification(qualificationPath, evidence);
  return evidence;
}

function errorVector(): BehaviorVector {
  return Object.fromEntries(
    LEDGER_BEHAVIORS.map((behavior) => [behavior, "error"]),
  ) as BehaviorVector;
}

export interface PreparedRealDeployment {
  readonly packageRoot: string;
  readonly packRoot: string;
  readonly pack: TaskPack;
  readonly launch: ReturnType<typeof dshLaunch>;
  readonly commonPatch: string;
  readonly controlPatch: string;
  readonly treatmentPatch: string;
  readonly controlConfigDigest: string;
  readonly treatmentConfigDigest: string;
  readonly commonPatchDigest: string;
  readonly controlPatchDigest: string;
  readonly treatmentPatchDigest: string;
  readonly dshPackageTreeDigest: string;
  readonly codexConnectDigest: string;
  readonly evalPackageDigest: string;
}

export async function prepareRealDeployment(packageRoot: string): Promise<PreparedRealDeployment> {
  const packRoot = `${packageRoot}/task-packs/open-coding-ts-ledger-v1`;
  const pack = await loadTaskPack(packRoot);
  const commonPatch = `${packageRoot}/variants/common.patch.yml`;
  const controlPatch = `${packageRoot}/variants/goal-off.patch.yml`;
  const treatmentPatch = `${packageRoot}/variants/goal-on.patch.yml`;
  const launch = dshLaunch();
  const [controlRows, treatmentRows] = await Promise.all([
    dumpRows(launch, commonPatch, controlPatch),
    dumpRows(launch, commonPatch, treatmentPatch),
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
  const codexConnectRoot = `${DEDICATED_DSH_HOME}/profiles/${PHASE2_INSTANCE.runnerProfile}/node_modules/dsh-codex-connect`;
  const [dshPackageTreeDigest, codexConnectDigest, evalPackageDigest] = await Promise.all([
    fingerprintPackageClosure(dshRoot),
    fingerprintPackageContent(codexConnectRoot),
    fingerprintPackageContent(packageRoot),
  ]);

  return {
    packageRoot,
    packRoot,
    pack,
    launch,
    commonPatch,
    controlPatch,
    treatmentPatch,
    controlConfigDigest,
    treatmentConfigDigest,
    commonPatchDigest: sha256Hex(commonPatchBytes),
    controlPatchDigest: sha256Hex(controlPatchBytes),
    treatmentPatchDigest: sha256Hex(treatmentPatchBytes),
    dshPackageTreeDigest,
    codexConnectDigest,
    evalPackageDigest,
  };
}

export function deploymentDigestForTask(
  deployment: PreparedRealDeployment,
  taskPackDigest: string,
): string {
  return fingerprintEvalDeployment({
    control: deployment.controlConfigDigest,
    treatment: deployment.treatmentConfigDigest,
    task_pack: taskPackDigest,
    model: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "xhigh" },
    dsh_package_tree: deployment.dshPackageTreeDigest,
    codex_connect_package: deployment.codexConnectDigest,
    eval_package: deployment.evalPackageDigest,
    common_patch: deployment.commonPatchDigest,
  });
}

export function variantsForQualification(
  deployment: PreparedRealDeployment,
  qualification: QualificationEvidence,
): { readonly control: VariantSpec; readonly treatment: VariantSpec } {
  const variant = (
    variantId: "goal-off" | "goal-on",
    armPatchSha256: string,
    resolvedConfigSha256: string,
    enabled: boolean,
  ): VariantSpec =>
    parseVariantSpec({
      schema_version: 1,
      variant_id: variantId,
      common_patch_sha256: deployment.commonPatchDigest,
      arm_patch_sha256: armPatchSha256,
      expected_goal_rows: {
        goal: enabled,
        goal_round_driver: enabled,
        command_goal: enabled,
        tool_goal: enabled,
      },
      dsh_package_tree_sha256: deployment.dshPackageTreeDigest,
      codex_connect_package_sha256: deployment.codexConnectDigest,
      eval_package_sha256: deployment.evalPackageDigest,
      model_route: {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        reasoning_effort: "xhigh",
      },
      resolved_config_sha256: resolvedConfigSha256,
      tool_schema_sha256: qualification.common_tool_schema_sha256,
      tools_mode: "native",
      permission_mode: "workspace-write",
    });
  const variants = {
    control: variant(
      "goal-off",
      deployment.controlPatchDigest,
      deployment.controlConfigDigest,
      false,
    ),
    treatment: variant(
      "goal-on",
      deployment.treatmentPatchDigest,
      deployment.treatmentConfigDigest,
      true,
    ),
  } as const;
  return variants;
}

export interface RealCampaignExecutionInput {
  readonly campaignRoot: string;
  readonly experiment: ExperimentSpec;
  readonly variants: { readonly control: VariantSpec; readonly treatment: VariantSpec };
  readonly executeArm: (arm: "control" | "treatment") => Promise<ArmExecutionOutput>;
  readonly evaluateArm: (
    arm: "control" | "treatment",
    output: ArmExecutionOutput,
  ) => Promise<ArmEvaluationOutput>;
}

export async function executePreparedRealCampaign<T>(input: {
  readonly deployment: PreparedRealDeployment;
  readonly campaignId: string;
  readonly createdAt: string;
  readonly timeoutMs: number;
  readonly taskPackIdentity: TaskPackIdentity;
  readonly taskPackDigest: string;
  readonly publicTask: string;
  readonly calibration: CalibrationEvidence;
  readonly qualification: QualificationEvidence;
  readonly materializeBase: (destination: string) => Promise<void>;
  readonly coordinate: (execution: RealCampaignExecutionInput) => Promise<T>;
}): Promise<{ readonly campaignRoot: string; readonly result: T }> {
  const deploymentDigest = deploymentDigestForTask(input.deployment, input.taskPackDigest);
  if (
    input.calibration.task_pack_digest !== input.taskPackDigest ||
    input.calibration.calibration_digest !== input.taskPackIdentity.pack.calibration_digest ||
    input.calibration.eval_package_sha256 !== input.deployment.evalPackageDigest
  ) {
    throw new Error("calibration evidence is not bound to the current deployment");
  }
  const qualification = parseQualificationEvidence({
    ...input.qualification,
    deployment_digest: deploymentDigest,
  });
  const variants = variantsForQualification(input.deployment, qualification);
  const controlDigest = sha256Hex(canonicalJson(variants.control));
  const treatmentDigest = sha256Hex(canonicalJson(variants.treatment));

  const armOrder = randomInt(2) === 0 ? ["control", "treatment"] : ["treatment", "control"];
  const experiment = parseExperimentSpec({
    schema_version: 1,
    campaign_id: input.campaignId,
    created_at: input.createdAt,
    domain: "open-coding-delivery",
    eval_pack_id: "open-coding-delivery-v1",
    task_pack_digest: input.taskPackDigest,
    control_variant_digest: controlDigest,
    treatment_variant_digest: treatmentDigest,
    deployment: {
      digest: deploymentDigest,
      eval_package_sha256: input.deployment.evalPackageDigest,
      qualification,
      calibration: input.calibration,
    },
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
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${input.campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  const workspaces = createOpaqueArmWorkspaces();
  await Promise.all([
    input.materializeBase(workspaces.control),
    input.materializeBase(workspaces.treatment),
  ]);
  await Promise.all([
    initializeMaterializedGitWorkspace(workspaces.control),
    initializeMaterializedGitWorkspace(workspaces.treatment),
  ]);
  const carrier = new DshRunCarrier();
  let oracleSeed: number | undefined;
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${input.deployment.packRoot}/oracle/runner.mjs`,
  });
  const result = await input.coordinate({
    campaignRoot,
    experiment,
    variants,
    executeArm: async (arm): Promise<ArmExecutionOutput> => {
      const workspace = workspaces[arm];
      const before = await scanRawSessionInventory(PHASE2_INSTANCE.sessionsRoot);
      const startedAt = new Date().toISOString();
      const monotonicStart = performance.now();
      const processResult = await carrier.runEpisode({
        ...input.deployment.launch,
        workspace,
        commonPatch: input.deployment.commonPatch,
        armPatch:
          arm === "control" ? input.deployment.controlPatch : input.deployment.treatmentPatch,
        task: input.publicTask,
        timeoutMs: input.timeoutMs,
      });
      const elapsedMs = Math.max(0, Math.round(performance.now() - monotonicStart));
      const endedAt = new Date().toISOString();
      if (processResult.timedOut || processResult.outputLimitExceeded) {
        throw new Error("arm exceeded a process boundary before trustworthy freeze");
      }
      const after = await scanRawSessionInventory(PHASE2_INSTANCE.sessionsRoot);
      const discovered = discoverFreshSession({ before, after, workspace, startedAt, endedAt });
      const transcriptPath = locatedSession(after, discovered.id).transcriptPath;
      const transcript = await readStableSessionTranscript(transcriptPath);
      const frozen = await freezeCandidate({
        workspace,
        artifactRoot: `${campaignRoot}/arms/${arm}`,
      });
      return {
        sessionId: discovered.id,
        sessionLog: transcript,
        candidateTree: frozen.tree,
        candidatePatch: await readFile(frozen.patchPath),
        candidateArchive: await readFile(frozen.archivePath),
        candidateChangedPaths: frozen.changedPaths,
        candidateUnauthorizedPaths: frozen.unauthorizedPaths,
        candidateForbiddenEntries: frozen.forbiddenEntries,
        workspaceBaseDigest: input.taskPackIdentity.pack.base_tree_sha256,
        process: {
          started_at: startedAt,
          ended_at: endedAt,
          exit_code: processResult.exitCode,
          signal: processResult.signal,
          timed_out: processResult.timedOut,
        },
        elapsedMs,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        oracleInput: {
          archivePath: frozen.archivePath,
          candidateAuthorized: frozen.authorized,
          workspace,
          frozenTree: frozen.tree,
        } satisfies RealArmOracleInput,
      };
    },
    evaluateArm: async (_arm, output): Promise<ArmEvaluationOutput> => {
      const oracleInput = output.oracleInput as RealArmOracleInput;
      oracleSeed ??= randomInt(0, 2_147_483_647);
      const scratchParent = `${PHASE2_INSTANCE.instanceRoot}/oracle-tmp`;
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
      const candidateTreeAfterOracle = await computeCandidateTree(
        oracleInput.workspace,
        `${PHASE2_INSTANCE.instanceRoot}/oracle-tmp/tree-verification`,
      );
      return {
        behavior,
        candidateTreeAfterOracle,
        oracleSeed: {
          schema_version: 1,
          seed: oracleSeed,
          oracle_version: input.taskPackIdentity.pack.oracle_version,
        },
      };
    },
  });
  return { campaignRoot, result };
}

async function copyLegacyBase(
  deployment: PreparedRealDeployment,
  destination: string,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await cp(`${deployment.packRoot}/base`, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await chmod(destination, 0o700);
}

export async function runRealCampaign(input: {
  readonly packageRoot: string;
  readonly timeoutMs: number;
  readonly confirm: (summary: string) => Promise<boolean>;
}): Promise<{ readonly campaignId: string; readonly pointers: CampaignPointers }> {
  const deployment = await prepareRealDeployment(input.packageRoot);
  const taskPackIdentity = await loadTaskPackIdentity(deployment.packRoot);
  const taskPackDigest = await digestTaskPack(deployment.packRoot);
  const publicTask = await readFile(
    `${deployment.packRoot}/${deployment.pack.public_task_ref}`,
    "utf8",
  );
  const calibration = parseCalibrationEvidence(
    JSON.parse(
      await readFile(`${PHASE2_INSTANCE.instanceRoot}/calibration/${taskPackDigest}.json`, "utf8"),
    ),
  );
  const confirmed = await input.confirm(
    `Run one read-only qualification if needed and two model Episodes (max ${input.timeoutMs} ms per arm)?`,
  );
  if (!confirmed) throw new Error("Campaign confirmation declined");
  const deploymentDigest = deploymentDigestForTask(deployment, taskPackDigest);
  let qualification: QualificationEvidence;
  try {
    qualification = await qualifyCarrier({
      launch: deployment.launch,
      packageRoot: deployment.packageRoot,
      commonPatch: deployment.commonPatch,
      controlPatch: deployment.controlPatch,
      deploymentDigest,
    });
  } catch {
    throw new CarrierQualificationError();
  }
  const campaignId = `campaign-${new Date()
    .toISOString()
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const executed = await executePreparedRealCampaign({
    deployment,
    campaignId,
    createdAt: new Date().toISOString(),
    timeoutMs: input.timeoutMs,
    taskPackIdentity,
    taskPackDigest,
    publicTask,
    calibration,
    qualification,
    materializeBase: (destination) => copyLegacyBase(deployment, destination),
    coordinate: (execution) =>
      runPairedCampaign({
        ...execution,
        taskPackIdentity,
        publicTask,
      }),
  });
  return { campaignId, pointers: executed.result.pointers };
}
