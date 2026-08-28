import { spawn } from "node:child_process";

import {
  FORWARD_RUN_NONCE_ENV,
  FORWARD_RUN_ROOT_ENV,
  ForwardEvidenceStore,
  type ForwardRunProjection,
} from "../../src/author-evidence/index.js";
import {
  type AuthorForwardOutput,
  captureForwardProjection,
  FORWARD_ERROR_MARKERS,
  FORWARD_MAX_OUTPUT_BYTES,
  FORWARD_MODEL_ROUTE,
  FORWARD_POST_OUTPUT_EXIT_GRACE_MS,
  type InternalAuthorForwardInput,
  incompleteForwardProjection,
  readForwardReviewedPackage,
  verifyForwardFixture,
} from "../../src/carrier/author-forward-internal.js";
import type { AuthorForwardLaunchCapability } from "../../src/carrier/author-forward-production.js";
import { sha256Hex } from "../../src/contracts/canonical-json.js";
import { PHASE2_INSTANCE, PHASE3A_AUTHOR } from "../../src/instance.js";
import { DEDICATED_DSH_HOME } from "../../src/runtime-root.js";

export interface TestAuthorForwardInput extends InternalAuthorForwardInput {
  readonly executable: string;
  readonly launcherArgs?: readonly string[];
}

interface TestRuntimeInput {
  readonly sourceRevision: string;
  readonly packageTarPath: string;
  readonly packageTar: Buffer;
  readonly packageContentSha256: string;
  readonly packageVersion: string;
}

export function createTestAuthorForwardCarrier(
  dependencies: {
    readonly verifyRuntime?: (input: TestRuntimeInput) => Promise<AuthorForwardLaunchCapability>;
    readonly beforeLaunch?: () => Promise<void>;
  } = {},
) {
  return {
    async run(input: TestAuthorForwardInput): Promise<AuthorForwardOutput> {
      const { executable, launcherArgs = [], ...carrierInput } = input;
      const postOutputExitGraceMs =
        carrierInput.postOutputExitGraceMs ?? FORWARD_POST_OUTPUT_EXIT_GRACE_MS;
      if (!Number.isFinite(carrierInput.timeoutMs) || carrierInput.timeoutMs <= 0) {
        throw new RangeError("author forward timeout must be positive and finite");
      }
      if (!Number.isFinite(postOutputExitGraceMs) || postOutputExitGraceMs <= 0) {
        throw new RangeError("post-output exit grace must be positive and finite");
      }
      if (!/^[a-f0-9]{40}$/.test(carrierInput.sourceRevision)) {
        throw new TypeError("author forward source revision must be an exact Git SHA");
      }
      const fixture = await verifyForwardFixture(carrierInput.workspace);
      const reviewedPackage = await readForwardReviewedPackage(
        carrierInput.packageTarPath,
        carrierInput.sourceRevision,
      );
      const runtime = await (
        dependencies.verifyRuntime ??
        (async (): Promise<AuthorForwardLaunchCapability> => ({
          descriptor: {
            node_version: "v24.16.0",
            package_version: "0.1.0-rc.6",
            package_content_sha256: "e".repeat(64),
            package_closure_sha256: "f".repeat(64),
          },
          assertUnchanged: async () => undefined,
          launch: async (launchInput) =>
            spawn(executable, [...launcherArgs, ...launchInput.argv], {
              cwd: launchInput.cwd,
              env: launchInput.env,
              stdio: ["ignore", "pipe", "pipe"],
            }),
        }))
      )({
        sourceRevision: carrierInput.sourceRevision,
        packageTarPath: carrierInput.packageTarPath,
        packageTar: reviewedPackage.bytes,
        packageContentSha256: reviewedPackage.contentSha256,
        packageVersion: reviewedPackage.packageVersion,
      });
      const store = new ForwardEvidenceStore(carrierInput.evidenceRoot);
      const handle = await store.beginRun({
        runId: carrierInput.runId,
        sourceRevision: carrierInput.sourceRevision,
        packageTar: {
          sha256: sha256Hex(reviewedPackage.bytes),
          size: reviewedPackage.bytes.byteLength,
        },
        profile: PHASE3A_AUTHOR.profile,
        provider: FORWARD_MODEL_ROUTE.provider,
        model: FORWARD_MODEL_ROUTE.model,
        effort: FORWARD_MODEL_ROUTE.effort,
        promptSha256: sha256Hex(carrierInput.task),
        fixtureSetSha256: fixture.digest,
        dshLauncher: runtime.descriptor,
        startedAt: new Date().toISOString(),
      });
      await dependencies.beforeLaunch?.();
      const child = await runtime.launch({
        argv: ["--profile", PHASE3A_AUTHOR.profile, carrierInput.task],
        cwd: fixture.workspace.path,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          DSH_HOME: DEDICATED_DSH_HOME,
          DSH_EVAL_INSTANCE_ID: PHASE2_INSTANCE.id,
          DSH_TOOLS_MODE: "native",
          DSH_PERMISSION_MODE: "workspace-write",
          [FORWARD_RUN_ROOT_ENV]: handle.runRoot,
          [FORWARD_RUN_NONCE_ENV]: handle.nonce,
        },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let outputLimitExceeded = false;
      let timedOut = false;
      let spawnError = false;
      let killTimer: NodeJS.Timeout | undefined;
      let postOutputExitTimer: NodeJS.Timeout | undefined;
      const terminate = () => {
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
        killTimer.unref();
      };
      const armPostOutputExit = () => {
        if (postOutputExitTimer !== undefined) clearTimeout(postOutputExitTimer);
        postOutputExitTimer = setTimeout(terminate, postOutputExitGraceMs);
        postOutputExitTimer.unref();
      };
      const capture = (target: Buffer[], onData?: () => void) => (chunk: Buffer) => {
        const remaining = Math.max(0, FORWARD_MAX_OUTPUT_BYTES - outputBytes);
        if (remaining > 0) {
          const retained = chunk.subarray(0, remaining);
          target.push(Buffer.from(retained));
          outputBytes += retained.byteLength;
        }
        if (chunk.byteLength > remaining && !outputLimitExceeded) {
          outputLimitExceeded = true;
          terminate();
        }
        if (!outputLimitExceeded) onData?.();
      };
      child.stdout.on("data", capture(stdout, armPostOutputExit));
      child.stderr.on("data", capture(stderr));
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, carrierInput.timeoutMs);
      timeout.unref();
      const terminal = await new Promise<{ exitCode: number | null; signal: string | null }>(
        (resolveTerminal) => {
          child.once("error", () => {
            spawnError = true;
          });
          child.once("close", (exitCode, signal) => {
            resolveTerminal({ exitCode, signal });
          });
        },
      );
      clearTimeout(timeout);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (postOutputExitTimer !== undefined) clearTimeout(postOutputExitTimer);
      let runtimeIdentityChanged = false;
      try {
        await runtime.assertUnchanged();
      } catch {
        runtimeIdentityChanged = true;
      }
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const combined = `${stdoutText}\n${stderrText}`;
      const errorMarkers: string[] = FORWARD_ERROR_MARKERS.filter((marker) =>
        combined.includes(marker),
      );
      if (spawnError) errorMarkers.push("SPAWN_ERROR");
      if (runtimeIdentityChanged) errorMarkers.push("RUNTIME_IDENTITY_CHANGED");
      let projection: ForwardRunProjection;
      try {
        projection = await captureForwardProjection({
          fixture,
          handle,
          evidenceRoot: carrierInput.evidenceRoot,
        });
      } catch {
        errorMarkers.push("PROJECTION_ERROR");
        projection = incompleteForwardProjection(fixture, handle);
      }
      const receipt = await store.completeRun(handle, {
        endedAt: new Date().toISOString(),
        exitCode: terminal.exitCode,
        signal: terminal.signal,
        timedOut,
        outputLimitExceeded,
        finalOutputSeen: stdoutText.trim().length > 0,
        errorMarkers,
        stdoutSha256: sha256Hex(stdoutText),
        stderrSha256: sha256Hex(stderrText),
        projection,
      });
      return {
        exitCode: terminal.exitCode,
        signal: terminal.signal,
        stdout: stdoutText,
        stderr: stderrText,
        timedOut,
        outputLimitExceeded,
        receipt,
      };
    },
  };
}
