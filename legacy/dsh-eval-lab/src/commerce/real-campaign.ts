import { randomInt, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { ArmExecutionOutput, CampaignPointers } from "../campaign/coordinator.js";
import {
  CarrierQualificationError,
  createOpaqueArmWorkspaces,
  deploymentDigestForTask,
  initializeGitWorkspace,
  prepareRealDeployment,
  qualifyCarrier,
  variantsForQualification,
} from "../campaign/real.js";
import { DshRunCarrier } from "../carrier/dsh-run.js";
import { discoverFreshSession } from "../carrier/session-discovery.js";
import {
  readStableSessionTranscript,
  scanRawSessionInventory,
} from "../carrier/session-inventory.js";
import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import type { QualificationEvidence } from "../contracts/parsers.js";
import { computeCandidateTree, freezeCandidate } from "../freeze/candidate.js";
import { PHASE2_INSTANCE } from "../instance.js";
import {
  COMMERCE_BEHAVIORS,
  type CommerceBehaviorVector,
  CommerceOrderOracle,
} from "../oracle/commerce-order.js";
import { StrictProcessRunner } from "../process/strict-runner.js";
import { digestTaskPack, loadTaskPackIdentity } from "../task-pack/loader.js";
import { type CommerceArmEvaluationOutput, runCommercePairedCampaign } from "./campaign.js";
import { parseCommerceExperiment, parseCommerceVariant } from "./campaign-contracts.js";

function errorVector(): CommerceBehaviorVector {
  return Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [behavior, "error"]),
  ) as CommerceBehaviorVector;
}

function inventoryEntry(
  inventory: Awaited<ReturnType<typeof scanRawSessionInventory>>,
  id: string,
) {
  const entry = inventory.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error("Commerce Session transcript is missing");
  return entry;
}

export async function runRealCommerceCampaign(input: {
  readonly packageRoot: string;
  readonly timeoutMs: number;
  readonly admissionSha256: string;
  readonly confirm: (summary: string) => Promise<boolean>;
}): Promise<{ readonly campaignId: string; readonly pointers: CampaignPointers }> {
  const deployment = await prepareRealDeployment(
    input.packageRoot,
    "task-packs/open-coding-ts-commerce-order-v1",
  );
  const [taskPackIdentity, taskPackDigest, publicTask] = await Promise.all([
    loadTaskPackIdentity(deployment.packRoot),
    digestTaskPack(deployment.packRoot),
    readFile(`${deployment.packRoot}/${deployment.pack.public_task_ref}`, "utf8"),
  ]);
  if (
    taskPackIdentity.schema_version !== 2 ||
    taskPackIdentity.template_id !== "commerce-order-cancellation-v1"
  ) {
    throw new Error("real Commerce Campaign requires the commerce Task Pack");
  }
  if (!/^[0-9a-f]{64}$/.test(input.admissionSha256)) {
    throw new Error("real Commerce Campaign requires one admission digest");
  }
  const confirmed = await input.confirm(
    `Run Commerce qualification if needed and two model Episodes (max ${input.timeoutMs} ms per arm)?`,
  );
  if (!confirmed) throw new Error("Commerce Campaign confirmation declined");
  const deploymentDigest = deploymentDigestForTask(deployment, taskPackDigest);
  let qualification: QualificationEvidence;
  try {
    qualification = await qualifyCarrier({
      launch: deployment.launch,
      packageRoot: deployment.packageRoot,
      baseRoot: `${deployment.packRoot}/base`,
      commonPatch: deployment.commonPatch,
      controlPatch: deployment.controlPatch,
      deploymentDigest,
    });
  } catch {
    throw new CarrierQualificationError();
  }
  const baseVariants = variantsForQualification(deployment, qualification);
  const variants = {
    control: parseCommerceVariant({
      ...baseVariants.control,
      schema_version: 2,
      template_id: "commerce-order-cancellation-v1",
    }),
    treatment: parseCommerceVariant({
      ...baseVariants.treatment,
      schema_version: 2,
      template_id: "commerce-order-cancellation-v1",
    }),
  } as const;
  const controlDigest = sha256Hex(canonicalJson(variants.control));
  const treatmentDigest = sha256Hex(canonicalJson(variants.treatment));
  const qualificationProjection =
    qualification.deployment_digest === deploymentDigest
      ? undefined
      : {
          source_deployment_digest: qualification.deployment_digest,
          projected_deployment_digest: deploymentDigest,
          source_qualification_sha256: canonicalJsonDigest(qualification),
        };
  const campaignId = `commerce-campaign-${new Date()
    .toISOString()
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const experiment = parseCommerceExperiment({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v1",
    campaign_id: campaignId,
    created_at: new Date().toISOString(),
    domain: "open-coding-commerce-delivery",
    eval_pack_id: "open-coding-commerce-delivery-v1",
    task_pack_digest: taskPackDigest,
    control_variant_digest: controlDigest,
    treatment_variant_digest: treatmentDigest,
    deployment: {
      digest: deploymentDigest,
      eval_package_sha256: deployment.evalPackageDigest,
      qualification,
      ...(qualificationProjection === undefined
        ? {}
        : { qualification_projection: qualificationProjection }),
      grader_admission_sha256: input.admissionSha256,
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
    arm_order: randomInt(2) === 0 ? ["control", "treatment"] : ["treatment", "control"],
    timeout_ms_per_arm: input.timeoutMs,
    claim_strength: "diagnostic",
    effect_claim_eligible: false,
  });
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  const workspaces = createOpaqueArmWorkspaces();
  await Promise.all([
    initializeGitWorkspace(`${deployment.packRoot}/base`, workspaces.control),
    initializeGitWorkspace(`${deployment.packRoot}/base`, workspaces.treatment),
  ]);
  const carrier = new DshRunCarrier();
  const oracle = new CommerceOrderOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${deployment.packRoot}/oracle/runner.mjs`,
  });
  let oracleSeed: number | undefined;
  const executeArm = async (arm: "control" | "treatment"): Promise<ArmExecutionOutput> => {
    const workspace = workspaces[arm];
    const before = await scanRawSessionInventory(PHASE2_INSTANCE.sessionsRoot);
    const startedAt = new Date().toISOString();
    const monotonicStart = performance.now();
    const processResult = await carrier.runEpisode({
      ...deployment.launch,
      workspace,
      commonPatch: deployment.commonPatch,
      armPatch: arm === "control" ? deployment.controlPatch : deployment.treatmentPatch,
      task: publicTask,
      timeoutMs: input.timeoutMs,
    });
    const elapsedMs = Math.max(0, Math.round(performance.now() - monotonicStart));
    const endedAt = new Date().toISOString();
    if (processResult.timedOut || processResult.outputLimitExceeded) {
      throw new Error("Commerce arm exceeded a trustworthy process boundary");
    }
    const after = await scanRawSessionInventory(PHASE2_INSTANCE.sessionsRoot);
    const discovered = discoverFreshSession({ before, after, workspace, startedAt, endedAt });
    const transcript = await readStableSessionTranscript(
      inventoryEntry(after, discovered.id).transcriptPath,
    );
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
      workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
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
      },
    };
  };
  const evaluateArm = async (
    _arm: "control" | "treatment",
    output: ArmExecutionOutput,
  ): Promise<CommerceArmEvaluationOutput> => {
    const oracleInput = output.oracleInput as {
      readonly archivePath: string;
      readonly candidateAuthorized: boolean;
      readonly workspace: string;
      readonly frozenTree: string;
    };
    oracleSeed ??= randomInt(0, 2_147_483_647);
    const scratchParent = `${PHASE2_INSTANCE.instanceRoot}/oracle-tmp`;
    await mkdir(scratchParent, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(`${scratchParent}/commerce-${randomUUID()}-`);
    let behavior: CommerceBehaviorVector;
    try {
      behavior = oracleInput.candidateAuthorized
        ? await oracle.evaluateArchive(oracleInput.archivePath, oracleSeed, scratch)
        : errorVector();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    const candidateTreeAfterOracle = await computeCandidateTree(
      oracleInput.workspace,
      `${PHASE2_INSTANCE.instanceRoot}/oracle-tmp/commerce-tree-verification`,
    );
    return {
      behavior,
      candidateTreeAfterOracle,
      oracleSeed: {
        schema_version: 2,
        template_id: "commerce-order-cancellation-v1",
        seed: oracleSeed,
        oracle_version: "commerce-order-oracle-v1",
      },
    };
  };
  const result = await runCommercePairedCampaign({
    campaignRoot,
    experiment,
    variants,
    taskPackIdentity,
    publicTask,
    executeArm,
    evaluateArm,
  });
  return { campaignId, pointers: result.pointers };
}
