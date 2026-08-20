import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import {
  FORWARD_FIXTURE_MANIFEST,
  FORWARD_FIXTURES_ROOT,
  FORWARD_LABELS_ROOT,
  FORWARD_PACKAGES_ROOT,
  InternalAuthorForwardCarrier,
} from "../../src/carrier/author-forward-internal.js";
import { verifyAuthorForwardProductionRuntime } from "../../src/carrier/author-forward-production.js";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../src/contracts/canonical-json.js";
import {
  fingerprintPackageClosure,
  fingerprintPackageContent,
} from "../../src/fingerprint/deployment.js";
import { authorProfileFiles, materializeFrozenFiles } from "../../src/runtime-profile/init.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

async function scratch(): Promise<string> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(`${parent}/forward-production-`);
}

function minimalPackageTarGzip(): { readonly bytes: Buffer; readonly packageJson: string } {
  const packageJson = `${JSON.stringify({ name: "dsh-eval-lab", version: "0.3.0-alpha.1" })}\n`;
  const content = Buffer.from(packageJson);
  const header = Buffer.alloc(512);
  header.write("package/package.json", 0, "utf8");
  header.write("0000600\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(`${content.byteLength.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  const padding = Buffer.alloc((512 - (content.byteLength % 512)) % 512);
  return {
    bytes: gzipSync(Buffer.concat([header, content, padding, Buffer.alloc(1_024)])),
    packageJson,
  };
}

test("production preflight closes live author bytes and the fixed DSH launcher", async () => {
  const root = await scratch();
  const dshHome = `${root}/dsh-home`;
  const authorRoot = `${dshHome}/profiles/eval-clowder-author`;
  const installedRoot = `${authorRoot}/node_modules/dsh-eval-lab`;
  const dshRuntimeRoot = `${root}/dsh-runtime`;
  const dshPackageRoot = `${dshRuntimeRoot}/node_modules/@deepseek-ai/dsh`;
  const reviewedTar = `${root}/reviewed.tgz`;
  try {
    await mkdir(dshHome, { recursive: true, mode: 0o700 });
    await writeFile(
      `${dshHome}/settings.yaml`,
      "agent-default-model:\n  provider: openai-codex\n  model: gpt-5.6-sol\n  reasoningEffort: xhigh\n",
      { mode: 0o600 },
    );
    await mkdir(authorRoot, { recursive: true, mode: 0o700 });
    await writeFile(reviewedTar, "synthetic reviewed tar identity", { mode: 0o600 });
    const packageSpec = pathToFileURL(reviewedTar).href;
    await materializeFrozenFiles(authorRoot, authorProfileFiles(packageSpec));
    await mkdir(installedRoot, { recursive: true, mode: 0o700 });
    await writeFile(
      `${installedRoot}/package.json`,
      `${JSON.stringify({ name: "dsh-eval-lab", version: "0.3.0-alpha.1" })}\n`,
      { mode: 0o600 },
    );
    const packageContentSha256 = await fingerprintPackageContent(installedRoot);

    await mkdir(`${dshPackageRoot}/lib`, { recursive: true, mode: 0o700 });
    await writeFile(
      `${dshPackageRoot}/package.json`,
      `${JSON.stringify({
        name: "@deepseek-ai/dsh",
        version: "0.1.0-rc.6",
        bin: { dsh: "lib/bin.js" },
      })}\n`,
      { mode: 0o600 },
    );
    await writeFile(`${dshPackageRoot}/lib/bin.js`, "process.stdout.write('DSH_TEST')\n", {
      mode: 0o700,
    });
    const [expectedDshContentSha256, expectedDshClosureSha256] = await Promise.all([
      fingerprintPackageContent(dshPackageRoot),
      fingerprintPackageClosure(dshPackageRoot),
    ]);
    const config = {
      dshHome,
      authorProfileRoot: authorRoot,
      dshRuntimeRoot,
      nodeExecutable: process.execPath,
      nodeVersion: process.version,
      expectedDshContentSha256,
      expectedDshClosureSha256,
    } as const;

    const runtime = await verifyAuthorForwardProductionRuntime(
      {
        packageTarPath: reviewedTar,
        packageContentSha256,
        packageVersion: "0.3.0-alpha.1",
      },
      config,
    );
    assert.equal(runtime.executable, process.execPath);
    assert.deepEqual(runtime.launcherArgs, [`${dshPackageRoot}/lib/bin.js`]);
    assert.equal(runtime.descriptor.package_content_sha256, expectedDshContentSha256);
    assert.equal(runtime.descriptor.package_closure_sha256, expectedDshClosureSha256);

    await assert.rejects(
      verifyAuthorForwardProductionRuntime(
        {
          packageTarPath: `${root}/other.tgz`,
          packageContentSha256,
          packageVersion: "0.3.0-alpha.1",
        },
        config,
      ),
      /does not bind the reviewed package tar/,
    );
    await assert.rejects(
      verifyAuthorForwardProductionRuntime(
        {
          packageTarPath: reviewedTar,
          packageContentSha256: "0".repeat(64),
          packageVersion: "0.3.0-alpha.1",
        },
        config,
      ),
      /package bytes do not match the reviewed tar/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("internal carrier reaches admission only through the production tar-profile-launcher closure", async () => {
  const root = await scratch();
  const sourceRevision = "8".repeat(40);
  const fixtureSetId = `production-chain-${process.pid}`;
  await mkdir(FORWARD_FIXTURES_ROOT, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(`${FORWARD_FIXTURES_ROOT}/production-chain-`);
  const labelsPath = `${FORWARD_LABELS_ROOT}/${fixtureSetId}.json`;
  const packageRevisionRoot = `${FORWARD_PACKAGES_ROOT}/${sourceRevision}`;
  const dshHome = `${root}/dsh-home`;
  const authorRoot = `${dshHome}/profiles/eval-clowder-author`;
  const installedRoot = `${authorRoot}/node_modules/dsh-eval-lab`;
  const dshRuntimeRoot = `${root}/dsh-runtime`;
  const dshPackageRoot = `${dshRuntimeRoot}/node_modules/@deepseek-ai/dsh`;
  const evidenceRoot = `${root}/evidence`;
  try {
    await mkdir(FORWARD_LABELS_ROOT, { recursive: true, mode: 0o700 });
    await mkdir(packageRevisionRoot, { recursive: true, mode: 0o700 });
    await mkdir(evidenceRoot, { mode: 0o700 });
    const fixtureManifest = { schema_version: 1, fixture_set_id: fixtureSetId, files: [] } as const;
    await writeFile(
      `${workspace}/${FORWARD_FIXTURE_MANIFEST}`,
      `${canonicalJson(fixtureManifest)}\n`,
      { mode: 0o600 },
    );
    const labels = {
      schema_version: 1,
      fixture_set_id: fixtureSetId,
      fixture_manifest_sha256: canonicalJsonDigest(fixtureManifest),
      labels: [],
    } as const;
    await writeFile(labelsPath, `${canonicalJson(labels)}\n`, { mode: 0o600 });
    const reviewed = minimalPackageTarGzip();
    const packageTarPath = `${packageRevisionRoot}/${sha256Hex(reviewed.bytes)}.tgz`;
    await writeFile(packageTarPath, reviewed.bytes, { mode: 0o600 });

    await mkdir(dshHome, { recursive: true, mode: 0o700 });
    await writeFile(
      `${dshHome}/settings.yaml`,
      "agent-default-model:\n  provider: openai-codex\n  model: gpt-5.6-sol\n  reasoningEffort: xhigh\n",
      { mode: 0o600 },
    );
    await mkdir(authorRoot, { recursive: true, mode: 0o700 });
    const packageSpec = pathToFileURL(packageTarPath).href;
    await materializeFrozenFiles(authorRoot, authorProfileFiles(packageSpec));
    await mkdir(installedRoot, { recursive: true, mode: 0o700 });
    await writeFile(`${installedRoot}/package.json`, reviewed.packageJson, { mode: 0o600 });

    await mkdir(`${dshPackageRoot}/lib`, { recursive: true, mode: 0o700 });
    await writeFile(
      `${dshPackageRoot}/package.json`,
      `${JSON.stringify({
        name: "@deepseek-ai/dsh",
        version: "0.1.0-rc.6",
        bin: { dsh: "lib/bin.js" },
      })}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      `${dshPackageRoot}/lib/bin.js`,
      "process.stdout.write('FINAL_SYNTHETIC_OUTPUT\\n')\n",
      { mode: 0o700 },
    );
    const [expectedDshContentSha256, expectedDshClosureSha256] = await Promise.all([
      fingerprintPackageContent(dshPackageRoot),
      fingerprintPackageClosure(dshPackageRoot),
    ]);
    const carrier = new InternalAuthorForwardCarrier({
      verifyRuntime: async (input) =>
        verifyAuthorForwardProductionRuntime(input, {
          dshHome,
          authorProfileRoot: authorRoot,
          dshRuntimeRoot,
          nodeExecutable: process.execPath,
          nodeVersion: process.version,
          expectedDshContentSha256,
          expectedDshClosureSha256,
        }),
    });
    const result = await carrier.run({
      workspace,
      task: "synthetic forward prompt",
      timeoutMs: 5_000,
      evidenceRoot,
      runId: "production-chain",
      sourceRevision,
      packageTarPath,
    });
    assert.equal(result.receipt.admission, "admitted");
    assert.equal(result.receipt.final_output_seen, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(labelsPath, { force: true });
    await rm(packageRevisionRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
