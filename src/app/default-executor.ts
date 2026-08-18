import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { type AuthExecutionInput, AuthFacade } from "../auth/facade.js";
import { createWorkspaceToolGuard } from "../bridge/guard.js";
import { createWorkspaceTestDefinition } from "../bridge/workspace-test.js";
import {
  type CampaignPointers,
  rebuildCampaignReport,
  writeMeasurementInvalidReport,
} from "../campaign/coordinator.js";
import {
  CarrierQualificationError,
  dshLaunch,
  dumpProfileRows,
  runRealCampaign,
} from "../campaign/real.js";
import {
  ArtifactIntegrityError,
  type ArtifactPointer,
  parseArtifactRef,
  readJsonArtifact,
  resolveArtifactRef,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { parseCurrentCalibrationEvidence, parsePairedImpactReport } from "../contracts/parsers.js";
import { replayPairedImpactReport } from "../contracts/replay.js";
import { readSuiteArtifactBytes } from "../contracts/suite-artifacts.js";
import { runDoctor } from "../doctor/index.js";
import { impactedByClaim } from "../domain/graph.js";
import { recordOperatorAuthority } from "../domain/operator-authority.js";
import { validateDomainPack } from "../domain/pack.js";
import {
  findPackageRoot,
  fingerprintPackageClosure,
  fingerprintPackageContent,
} from "../fingerprint/deployment.js";
import {
  assertExactGoalIntervention,
  type ComposedRow,
  VariantCompositionError,
} from "../fingerprint/variants.js";
import {
  ensurePhase2InstanceLayout,
  ensurePhase3AuthorLayout,
  PHASE2_INSTANCE,
  PHASE3A_AUTHOR,
  phase2CalibrationPath,
  resolvePhase2Instance,
} from "../instance.js";
import { calibrateLedgerPack } from "../oracle/calibration.js";
import { LedgerOracle } from "../oracle/ledger.js";
import { StrictProcessRunner } from "../process/strict-runner.js";
import { loadStaticEvalBinding } from "../registry/loader.js";
import { renderPairedReportMarkdown } from "../report/reporter.js";
import {
  assertAuthorProfileRoles,
  assertProfileRoles,
  authorProfileFiles,
  materializeFrozenFiles,
  runnerProfileFiles,
  verifyFrozenFiles,
  verifySharedModelSettings,
} from "../runtime-profile/init.js";
import {
  assertCredentialMetadata,
  assertDedicatedDshHomePreBoot,
  assertRuntimeLayoutInvariant,
  DEDICATED_DSH_HOME,
  DEDICATED_RUNTIME_ROOT,
  OAUTH_REFERENCE_ROOT,
} from "../runtime-root.js";
import { phase2TaskPackIdentity } from "../suite/identity.js";
import { runRealPhase2Suite } from "../suite/real.js";
import { rebuildSuiteReport, writeSuiteMeasurementInvalidEnvelope } from "../suite/recovery.js";
import { loadTaskPack } from "../task-pack/loader.js";
import { type AppInvocation, EXIT_CODE, type ExitCode } from "./args.js";
import type { DshEvalCommandExecutor } from "./startup.js";

const execFileAsync = promisify(execFile);
const SOURCE_ROOT = "/Users/slipshod/AIBuild/dsh-eval-lab";

function composedRow(rows: readonly ComposedRow[], id: string): ComposedRow {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`composed config is missing ${id}`);
  return row;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object value");
  }
  return value as Record<string, unknown>;
}

async function assertToolchainVersions(): Promise<void> {
  const [node, pnpm, git] = await Promise.all([
    execFileAsync(process.execPath, ["--version"]),
    execFileAsync("pnpm", ["--version"], { env: childEnvironment() }),
    execFileAsync("git", ["--version"], { env: childEnvironment() }),
  ]);
  if (!/^v24\./.test(node.stdout.trim())) throw new Error("Node 24 is required");
  if (pnpm.stdout.trim() !== "11.7.0") throw new Error("pnpm 11.7.0 is required");
  if (!/^git version \d+\./.test(git.stdout.trim())) throw new Error("Git is unavailable");
}

async function assertInstalledPackages(packageSpec: string): Promise<void> {
  await Promise.all([
    verifyFrozenFiles(runnerProfileRoot(), runnerProfileFiles(packageSpec)),
    verifyFrozenFiles(authorProfileRoot(), authorProfileFiles(packageSpec)),
  ]);
  const dshRoot = await findPackageRoot(dshLaunch().launcherArgs[0] ?? "", "@deepseek-ai/dsh");
  const [
    managementManifest,
    runnerEvalManifest,
    authorEvalManifest,
    codexManifest,
    dshManifest,
    runnerLockfile,
    authorLockfile,
  ] = await Promise.all([
    readFile(`${packageRoot()}/package.json`, "utf8").then(JSON.parse),
    readFile(`${runnerProfileRoot()}/node_modules/dsh-eval-lab/package.json`, "utf8").then(
      JSON.parse,
    ),
    readFile(`${authorProfileRoot()}/node_modules/dsh-eval-lab/package.json`, "utf8").then(
      JSON.parse,
    ),
    readFile(`${runnerProfileRoot()}/node_modules/dsh-codex-connect/package.json`, "utf8").then(
      JSON.parse,
    ),
    readFile(`${dshRoot}/package.json`, "utf8").then(JSON.parse),
    readFile(`${runnerProfileRoot()}/pnpm-lock.yaml`, "utf8"),
    readFile(`${authorProfileRoot()}/pnpm-lock.yaml`, "utf8"),
  ]);
  if (
    managementManifest.name !== "dsh-eval-lab" ||
    runnerEvalManifest.name !== "dsh-eval-lab" ||
    authorEvalManifest.name !== "dsh-eval-lab" ||
    managementManifest.version !== runnerEvalManifest.version ||
    managementManifest.version !== authorEvalManifest.version ||
    codexManifest.name !== "dsh-codex-connect" ||
    codexManifest.version !== "0.1.0-alpha.4.7" ||
    dshManifest.name !== "@deepseek-ai/dsh" ||
    dshManifest.version !== "0.1.0-rc.6" ||
    !runnerLockfile.includes("dsh-codex-connect@0.1.0-alpha.4.7") ||
    !runnerLockfile.includes(packageSpec) ||
    !authorLockfile.includes("dsh-codex-connect@0.1.0-alpha.4.7") ||
    !authorLockfile.includes(packageSpec)
  ) {
    throw new Error("installed package versions or lockfile drifted");
  }
  const [managementDigest, runnerDigest, authorDigest] = await Promise.all([
    fingerprintPackageContent(packageRoot()),
    fingerprintPackageContent(`${runnerProfileRoot()}/node_modules/dsh-eval-lab`),
    fingerprintPackageContent(`${authorProfileRoot()}/node_modules/dsh-eval-lab`),
  ]);
  await fingerprintPackageClosure(dshRoot);
  if (managementDigest !== runnerDigest || managementDigest !== authorDigest) {
    throw new Error("management, runner, and author Eval Lab package bytes differ");
  }
}

function assertBridgeConformance(): void {
  const guard = createWorkspaceToolGuard({ workspaceRoot: packageRoot() });
  if (guard({ name: "get_goal", arguments: {} }) !== undefined) {
    throw new Error("Goal tools are not admitted by the runner guard");
  }
  if (
    guard({ name: "create_goal", arguments: { objective: "probe", max_goal_rounds: 9 } }) ===
    undefined
  ) {
    throw new Error("Goal round cap is not enforced");
  }
  const tool = createWorkspaceTestDefinition({
    workspaceRoot: packageRoot(),
    runner: {
      run: async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false }),
    },
  });
  if (
    tool.name !== "workspace_test" ||
    tool.parameters.additionalProperties !== false ||
    Object.keys(tool.parameters.properties).length !== 0
  ) {
    throw new Error("workspace_test schema drifted");
  }
}

function assertRunnerRows(rows: readonly ComposedRow[]): void {
  assertProfileRoles(rows, "runner");
  if (composedRow(rows, "dsh-eval-domain-skill").disabled !== true) {
    throw new Error("domain authoring Skill must be disabled in the Candidate runner");
  }
  const persistence = objectValue(composedRow(rows, "session-persistence-jsonl").config);
  if (
    persistence.root !== PHASE2_INSTANCE.sessionsRoot ||
    persistence.compression !== "none" ||
    persistence.packChunks !== false
  ) {
    throw new Error("Session persistence is not frozen raw JSONL");
  }
  const approval = objectValue(composedRow(rows, "approval").config);
  const permission = objectValue(composedRow(rows, "permission").config);
  const presets = objectValue(permission.presets);
  const workspaceWrite = objectValue(presets["workspace-write"]);
  if (approval.policy !== "never" || workspaceWrite.approval !== "never") {
    throw new Error("headless approval policy is not frozen to never");
  }
  for (const id of [
    "tool-bash",
    "tool-pwsh",
    "tool-jobs",
    "tool-str-replace-editor",
    "tool-web",
    "tool-skill",
    "tool-subagent-control",
    "tool-subagent-list-agents",
    "tool-subagent",
    "tool-subagent-fork",
    "tool-subagent-report",
    "tool-workflow",
    "tool-ralph",
    "plan-mode",
  ]) {
    if (composedRow(rows, id).disabled !== true) throw new Error(`${id} must be disabled`);
  }
}

async function assertSandboxFunctionalProbe(): Promise<void> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/doctor/tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/sandbox-`);
  const allowed = `${scratch}/allowed`;
  const denied = `${scratch}/denied`;
  const writable = `${allowed}/tmp`;
  try {
    await Promise.all([mkdir(allowed, { mode: 0o700 }), mkdir(denied, { mode: 0o700 })]);
    await writeFile(`${denied}/sentinel.txt`, "synthetic sandbox sentinel", "utf8");
    const result = await new StrictProcessRunner().run({
      executable: process.execPath,
      args: [
        "-e",
        `const fs=require("node:fs");let denied=false;try{fs.readFileSync(${JSON.stringify(`${denied}/sentinel.txt`)})}catch{denied=true}fs.writeFileSync(${JSON.stringify(`${writable}/probe.txt`)},"ok");process.stdout.write(denied?"SANDBOX_OK":"SANDBOX_LEAK")`,
      ],
      cwd: allowed,
      readableRoots: [allowed],
      writableRoot: writable,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    });
    if (
      result.exitCode !== 0 ||
      result.timedOut ||
      result.outputLimitExceeded ||
      result.stdout !== "SANDBOX_OK"
    ) {
      throw new Error("sandbox functional probe failed");
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function packageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

function runnerProfileRoot(): string {
  return `${DEDICATED_DSH_HOME}/profiles/${PHASE2_INSTANCE.runnerProfile}`;
}

function authorProfileRoot(): string {
  return `${DEDICATED_DSH_HOME}/profiles/${PHASE3A_AUTHOR.profile}`;
}

function childEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    DSH_HOME: DEDICATED_DSH_HOME,
    DSH_EVAL_INSTANCE_ID: PHASE2_INSTANCE.id,
  };
}

async function managementPackageSpec(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(
      `${DEDICATED_DSH_HOME}/profiles/${PHASE2_INSTANCE.managementProfile}/package.json`,
      "utf8",
    ),
  ) as { dependencies?: Record<string, unknown> };
  const spec = manifest.dependencies?.["dsh-eval-lab"];
  if (typeof spec !== "string" || spec.length === 0) {
    throw new Error("management profile does not declare an exact dsh-eval-lab package spec");
  }
  return spec;
}

async function executeAuth(input: AuthExecutionInput) {
  if (input.stdio === "inherit") {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const child = spawn(input.executable, [...input.args], {
        env: { ...input.env },
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("close", resolveExit);
    });
    return { exitCode, stdout: "", stderr: "" };
  }
  try {
    const result = await execFileAsync(input.executable, [...input.args], {
      env: { ...input.env },
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      exitCode: typeof failed.code === "number" ? failed.code : null,
      stdout: typeof failed.stdout === "string" ? failed.stdout : "",
      stderr: typeof failed.stderr === "string" ? failed.stderr : "",
    };
  }
}

function authFacade(): AuthFacade {
  return new AuthFacade({
    executable: `${runnerProfileRoot()}/node_modules/.bin/dsh-codex-connect`,
    execute: executeAuth,
    env: childEnvironment() as Readonly<Record<string, string>>,
  });
}

async function confirmCampaign(summary: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(`${summary} Type RUN to continue: `)).trim() === "RUN";
  } finally {
    terminal.close();
  }
}

async function initializeRuntime(): Promise<void> {
  resolvePhase2Instance(process.env);
  await assertRuntimeLayoutInvariant({
    sourceRoot: SOURCE_ROOT,
    runtimeRoot: DEDICATED_RUNTIME_ROOT,
    dshHome: DEDICATED_DSH_HOME,
    oauthReferenceRoot: OAUTH_REFERENCE_ROOT,
  });
  await ensurePhase2InstanceLayout();
  await ensurePhase3AuthorLayout();
  const packageSpec = await managementPackageSpec();
  const profiles = [
    { root: runnerProfileRoot(), files: runnerProfileFiles(packageSpec) },
    { root: authorProfileRoot(), files: authorProfileFiles(packageSpec) },
  ] as const;
  for (const profile of profiles) await materializeFrozenFiles(profile.root, profile.files);
  await verifySharedModelSettings(DEDICATED_DSH_HOME);
  for (const profile of profiles) {
    await execFileAsync(
      "pnpm",
      ["install", "--config.auto-install-peers=false", "--lockfile-only", "--ignore-scripts"],
      { cwd: profile.root, env: childEnvironment() },
    );
    await execFileAsync(
      "pnpm",
      ["install", "--config.auto-install-peers=false", "--frozen-lockfile", "--ignore-scripts"],
      { cwd: profile.root, env: childEnvironment() },
    );
  }
}

async function phase2CalibrationTargets() {
  const binding = await loadStaticEvalBinding(packageRoot());
  const pack = await loadTaskPack(`${packageRoot()}/task-packs/open-coding-ts-ledger-v1`);
  return {
    binding,
    pack,
    targets: binding.tasks.map((task) => {
      const identity = phase2TaskPackIdentity(task, pack);
      return { task, identity, taskPackDigest: canonicalJsonDigest(identity) };
    }),
  };
}

async function runCalibration(): Promise<{
  readonly ready: boolean;
  readonly paths: readonly string[];
}> {
  const packRoot = `${packageRoot()}/task-packs/open-coding-ts-ledger-v1`;
  const pack = await loadTaskPack(packRoot);
  const scratchParent = `${PHASE2_INSTANCE.instanceRoot}/calibration/tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/run-`);
  try {
    const oracle = new LedgerOracle({
      runner: new StrictProcessRunner(),
      oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
    });
    const result = await calibrateLedgerPack({
      oracle,
      packRoot,
      scratchRoot: scratch,
      seed: 1729,
    });
    const evalPackageSha256 = await fingerprintPackageContent(packageRoot());
    const { targets } = await phase2CalibrationTargets();
    const paths: string[] = [];
    for (const target of targets) {
      const path = phase2CalibrationPath(target.taskPackDigest, evalPackageSha256);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const bytes = `${canonicalJson({
        ...result,
        task_pack_digest: target.taskPackDigest,
        calibration_digest: pack.calibration_digest,
        eval_package_sha256: evalPackageSha256,
      })}\n`;
      try {
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if ((await readFile(path, "utf8")) !== bytes) {
          throw new Error(`calibration artifact drift: ${target.task.task_id}`);
        }
      }
      paths.push(path);
    }
    return { ready: result.ready, paths };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function pointerFor(campaignRoot: string, ref: string): Promise<ArtifactPointer> {
  const bytes = await readFile(resolveArtifactRef(campaignRoot, ref));
  return { ref: parseArtifactRef(ref), sha256: sha256Hex(bytes) };
}

async function campaignPointers(campaignRoot: string): Promise<CampaignPointers> {
  const [report, markdown] = await Promise.all([
    pointerFor(campaignRoot, "artifact://campaign/report.json"),
    pointerFor(campaignRoot, "artifact://campaign/report.md"),
  ]);
  const frozenReport = await readJsonArtifact(campaignRoot, report, parsePairedImpactReport);
  return {
    experiment: frozenReport.evidence.experiment,
    controlEpisode: frozenReport.evidence.control_episode,
    treatmentEpisode: frozenReport.evidence.treatment_episode,
    evaluation: frozenReport.evidence.evaluation,
    report,
    markdown,
  };
}

async function campaignRootForRead(
  campaignId: string,
): Promise<{ readonly campaignRoot: string; readonly legacy: boolean }> {
  const current = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaignId}`;
  try {
    await lstat(current);
    return { campaignRoot: current, legacy: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const legacy = `${DEDICATED_RUNTIME_ROOT}/campaigns/${campaignId}`;
  try {
    await lstat(legacy);
    return { campaignRoot: legacy, legacy: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { campaignRoot: current, legacy: false };
}

async function runProductDoctor() {
  const packageSpec = await managementPackageSpec();
  const launch = dshLaunch();
  const commonPatch = `${packageRoot()}/variants/common.patch.yml`;
  const controlPatch = `${packageRoot()}/variants/goal-off.patch.yml`;
  const treatmentPatch = `${packageRoot()}/variants/goal-on.patch.yml`;
  let managementRows: Promise<readonly ComposedRow[]> | undefined;
  let runnerRows: Promise<readonly ComposedRow[]> | undefined;
  let authorRows: Promise<readonly ComposedRow[]> | undefined;
  let controlRows: Promise<readonly ComposedRow[]> | undefined;
  let treatmentRows: Promise<readonly ComposedRow[]> | undefined;
  const management = () =>
    (managementRows ??= dumpProfileRows(launch, PHASE2_INSTANCE.managementProfile, []));
  const runner = () => (runnerRows ??= dumpProfileRows(launch, PHASE2_INSTANCE.runnerProfile, []));
  const author = () => (authorRows ??= dumpProfileRows(launch, PHASE3A_AUTHOR.profile, []));
  const control = () =>
    (controlRows ??= dumpProfileRows(launch, PHASE2_INSTANCE.runnerProfile, [
      commonPatch,
      controlPatch,
    ]));
  const treatment = () =>
    (treatmentRows ??= dumpProfileRows(launch, PHASE2_INSTANCE.runnerProfile, [
      commonPatch,
      treatmentPatch,
    ]));
  return runDoctor([
    { id: "toolchain-versions", run: assertToolchainVersions },
    {
      id: "root-separation",
      run: () =>
        assertRuntimeLayoutInvariant({
          sourceRoot: SOURCE_ROOT,
          runtimeRoot: DEDICATED_RUNTIME_ROOT,
          dshHome: DEDICATED_DSH_HOME,
          oauthReferenceRoot: OAUTH_REFERENCE_ROOT,
        }),
    },
    {
      id: "dedicated-home-metadata",
      run: async () => {
        assertDedicatedDshHomePreBoot(process.env);
        await assertCredentialMetadata(DEDICATED_DSH_HOME);
      },
    },
    { id: "package-lock-and-bytes", run: () => assertInstalledPackages(packageSpec) },
    {
      id: "profile-roles",
      run: async () => {
        assertProfileRoles(await management(), "management");
        assertProfileRoles(await runner(), "runner");
        assertAuthorProfileRoles(await author());
      },
    },
    {
      id: "auth",
      run: async () => {
        if ((await authFacade().status()).status !== "signed-in") throw new Error("signed out");
      },
    },
    {
      id: "patch-dump-config",
      run: async () => {
        await dumpProfileRows(launch, PHASE2_INSTANCE.runnerProfile, [commonPatch]);
        await control();
        await treatment();
      },
    },
    {
      id: "variant-exact-diff",
      run: async () => void assertExactGoalIntervention(await control(), await treatment()),
    },
    { id: "bridge-conformance", run: async () => void assertBridgeConformance() },
    {
      id: "runner-safety-composition",
      run: async () => {
        assertRunnerRows(await control());
        assertRunnerRows(await treatment());
        await assertSandboxFunctionalProbe();
      },
    },
    {
      id: "task-pack",
      run: async () =>
        void (await loadTaskPack(`${packageRoot()}/task-packs/open-coding-ts-ledger-v1`)),
    },
    {
      id: "phase2-binding",
      run: async () => void (await loadStaticEvalBinding(packageRoot())),
    },
    {
      id: "calibration",
      run: async () => {
        const { pack, targets } = await phase2CalibrationTargets();
        const evalPackageDigest = await fingerprintPackageContent(packageRoot());
        for (const target of targets) {
          const path = phase2CalibrationPath(target.taskPackDigest, evalPackageDigest);
          const value = parseCurrentCalibrationEvidence(JSON.parse(await readFile(path, "utf8")));
          if (
            value.task_pack_digest !== target.taskPackDigest ||
            value.calibration_digest !== pack.calibration_digest ||
            value.eval_package_sha256 !== evalPackageDigest
          ) {
            throw new Error(`calibration artifact is stale: ${target.task.task_id}`);
          }
        }
      },
    },
  ]);
}

export class DefaultAppExecutor implements DshEvalCommandExecutor {
  readonly #stdout: (text: string) => void;
  readonly #stderr: (text: string) => void;
  readonly #cwd: string;

  constructor(
    input: {
      readonly stdout?: (text: string) => void;
      readonly stderr?: (text: string) => void;
      readonly cwd?: string;
    } = {},
  ) {
    this.#stdout = input.stdout ?? ((text) => void process.stdout.write(text));
    this.#stderr = input.stderr ?? ((text) => void process.stderr.write(text));
    this.#cwd = input.cwd ?? process.cwd();
  }

  async execute(invocation: AppInvocation): Promise<ExitCode> {
    try {
      switch (invocation.kind) {
        case "help":
          this.#stdout(
            "DSH Eval Lab: init | auth status | auth login | doctor | calibrate | binding show | run | report <campaign-id> | suite run | suite report <suite-id> | domain confirm/reject/withdraw <pack> <kind> <candidate> <actor> | domain validate <pack> <manifest> | domain impact <pack> <manifest> <claim-id>\n",
          );
          return EXIT_CODE.OK;
        case "version":
          this.#stdout(
            `dsh-eval-lab ${String(JSON.parse(await readFile(`${packageRoot()}/package.json`, "utf8")).version)}\n`,
          );
          return EXIT_CODE.OK;
        case "init":
          await initializeRuntime();
          this.#stdout(
            "Eval Lab runner and domain-author profiles initialized. Next: auth status, then explicit auth login.\n",
          );
          return EXIT_CODE.OK;
        case "auth-status": {
          const status = await authFacade().status();
          this.#stdout(`${JSON.stringify(status)}\n`);
          return status.status === "signed-in" ? EXIT_CODE.OK : EXIT_CODE.RUNTIME_NOT_READY;
        }
        case "auth-login":
          return (await authFacade().login()).signedIn ? EXIT_CODE.OK : EXIT_CODE.RUNTIME_NOT_READY;
        case "doctor": {
          const report = await runProductDoctor();
          this.#stdout(`${JSON.stringify(report)}\n`);
          return report.ready ? EXIT_CODE.OK : EXIT_CODE.RUNTIME_NOT_READY;
        }
        case "calibrate": {
          const result = await runCalibration();
          this.#stdout(`${JSON.stringify(result)}\n`);
          return result.ready ? EXIT_CODE.OK : EXIT_CODE.CALIBRATION_NOT_READY;
        }
        case "binding-show": {
          const binding = await loadStaticEvalBinding(packageRoot());
          this.#stdout(
            `${canonicalJson({
              schema_version: 1,
              instance_id: PHASE2_INSTANCE.id,
              management_profile: PHASE2_INSTANCE.managementProfile,
              runner_profile: PHASE2_INSTANCE.runnerProfile,
              harness: binding.harness,
              registry: binding.registry,
              eval_pack: binding.evalPack,
              tasks: binding.tasks,
              digests: binding.digests,
            })}\n`,
          );
          return EXIT_CODE.OK;
        }
        case "domain-validate": {
          const pack = await validateDomainPack(
            this.#cwd,
            invocation.packPath,
            invocation.manifestPath,
          );
          this.#stdout(`${canonicalJson(pack.readiness)}\n`);
          return pack.readiness.overall === "red" ? EXIT_CODE.DOMAIN_TRUTH_NOT_READY : EXIT_CODE.OK;
        }
        case "domain-impact": {
          const pack = await validateDomainPack(
            this.#cwd,
            invocation.packPath,
            invocation.manifestPath,
          );
          if (pack.readiness.overall === "red") return EXIT_CODE.DOMAIN_TRUTH_NOT_READY;
          this.#stdout(`${canonicalJson(impactedByClaim(pack.graph, invocation.claimId))}\n`);
          return EXIT_CODE.OK;
        }
        case "domain-authority": {
          const result = await recordOperatorAuthority({
            projectRoot: this.#cwd,
            packPath: invocation.packPath,
            candidatePath: invocation.candidatePath,
            targetKind: invocation.targetKind,
            actorId: invocation.actorId,
            decision: invocation.decision,
          });
          this.#stdout(`${canonicalJson(result)}\n`);
          return EXIT_CODE.OK;
        }
        case "run": {
          const doctor = await runProductDoctor();
          if (!doctor.ready) {
            this.#stderr("Runtime doctor is not ready; run `doctor` for the check matrix.\n");
            return EXIT_CODE.RUNTIME_NOT_READY;
          }
          const result = await runRealCampaign({
            packageRoot: packageRoot(),
            timeoutMs: invocation.timeoutMs,
            confirm: confirmCampaign,
          });
          this.#stdout(
            `Campaign ${result.campaignId} completed. Run report ${result.campaignId}.\n`,
          );
          return EXIT_CODE.OK;
        }
        case "report": {
          const { campaignRoot, legacy } = await campaignRootForRead(invocation.campaignId);
          if (legacy) {
            const reportPointer = await pointerFor(campaignRoot, "artifact://campaign/report.json");
            const replayed = await replayPairedImpactReport(campaignRoot, reportPointer);
            this.#stdout(renderPairedReportMarkdown(replayed.report));
            return EXIT_CODE.OK;
          }
          try {
            const pointers = await campaignPointers(campaignRoot);
            const rebuilt = await rebuildCampaignReport({
              campaignRoot,
              pointers,
            });
            this.#stdout(
              await readFile(resolveArtifactRef(campaignRoot, rebuilt.markdownPointer.ref), "utf8"),
            );
            return EXIT_CODE.OK;
          } catch (error) {
            const invalid = await writeMeasurementInvalidReport({
              campaignRoot,
              campaignId: invocation.campaignId,
            });
            this.#stdout(
              await readFile(resolveArtifactRef(campaignRoot, invalid.markdownPointer.ref), "utf8"),
            );
            throw error;
          }
        }
        case "suite-run": {
          const doctor = await runProductDoctor();
          if (!doctor.ready) {
            this.#stderr("Runtime doctor is not ready; run `doctor` for the check matrix.\n");
            return EXIT_CODE.RUNTIME_NOT_READY;
          }
          const completed = await runRealPhase2Suite({
            packageRoot: packageRoot(),
            timeoutMs: invocation.timeoutMs,
            confirm: confirmCampaign,
          });
          this.#stdout(
            `Suite ${completed.suiteId} completed. Run suite report ${completed.suiteId}.\n`,
          );
          return EXIT_CODE.OK;
        }
        case "suite-report": {
          const suiteRoot = `${PHASE2_INSTANCE.instanceRoot}/suites/${invocation.suiteId}`;
          try {
            const rebuilt = await rebuildSuiteReport({
              instanceRoot: PHASE2_INSTANCE.instanceRoot,
              suiteRoot,
            });
            this.#stdout(
              (await readSuiteArtifactBytes(suiteRoot, rebuilt.markdownPointer)).toString(),
            );
            return EXIT_CODE.OK;
          } catch (error) {
            const invalid = await writeSuiteMeasurementInvalidEnvelope({
              suiteRoot,
              suiteId: invocation.suiteId,
            });
            this.#stdout(
              (await readSuiteArtifactBytes(suiteRoot, invalid.markdownPointer)).toString(),
            );
            throw error;
          }
        }
      }
    } catch (error) {
      let exitCode: ExitCode = EXIT_CODE.CAMPAIGN_INFRASTRUCTURE_INVALID;
      let code = "CAMPAIGN_INFRASTRUCTURE_INVALID";
      if (
        error instanceof ArtifactIntegrityError ||
        invocation.kind === "report" ||
        invocation.kind === "suite-report"
      ) {
        exitCode = EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE;
        code = "ARTIFACT_INTEGRITY_FAILURE";
      } else if (error instanceof CarrierQualificationError) {
        exitCode = EXIT_CODE.CARRIER_QUALIFICATION_FAILED;
        code = "CARRIER_QUALIFICATION_FAILED";
      } else if (error instanceof VariantCompositionError) {
        exitCode = EXIT_CODE.VARIANT_COMPOSITION_INVALID;
        code = "VARIANT_COMPOSITION_INVALID";
      } else if (invocation.kind === "calibrate") {
        exitCode = EXIT_CODE.CALIBRATION_NOT_READY;
        code = "CALIBRATION_NOT_READY";
      } else if (
        invocation.kind === "domain-validate" ||
        invocation.kind === "domain-impact" ||
        invocation.kind === "domain-authority"
      ) {
        exitCode = EXIT_CODE.DOMAIN_TRUTH_NOT_READY;
        code = "DOMAIN_TRUTH_NOT_READY";
      } else if (
        invocation.kind === "init" ||
        invocation.kind === "doctor" ||
        invocation.kind === "auth-status" ||
        invocation.kind === "auth-login" ||
        invocation.kind === "binding-show"
      ) {
        exitCode = EXIT_CODE.RUNTIME_NOT_READY;
        code = "RUNTIME_NOT_READY";
      }
      this.#stderr(`DSH Eval Lab command failed (${code}).\n`);
      return exitCode;
    }
  }
}

export function createDefaultAppExecutor(): DshEvalCommandExecutor {
  return new DefaultAppExecutor();
}
