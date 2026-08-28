import { access, lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const required = [
  "README.md",
  "packages/weave/package.json",
  "packages/weave/bin/domain-eval.mjs",
  "packages/dsh-adapter/package.json",
  "legacy/dsh-eval-lab/package.json",
  "tsconfig.base.json",
  "tsconfig.public.json",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "docs/support-matrix.md",
  ".github/workflows/ci.yml",
];
const missing = [];
for (const path of required) {
  try {
    await access(resolve(repositoryRoot, path));
  } catch {
    missing.push(path);
  }
}
const publicIdentityMismatches = [];
const weaveManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "packages/weave/package.json"), "utf8"),
);
const adapterManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "packages/dsh-adapter/package.json"), "utf8"),
);
const legacyManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "legacy/dsh-eval-lab/package.json"), "utf8"),
);
const rootReadme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
const rootManifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
if (weaveManifest.name !== "@domaineval/weave") {
  publicIdentityMismatches.push("packages/weave/package.json#name");
}
if (weaveManifest.bin?.["domain-eval"] !== "./bin/domain-eval.mjs") {
  publicIdentityMismatches.push("packages/weave/package.json#bin.domain-eval");
}
if (adapterManifest.name !== "@domaineval/dsh-adapter") {
  publicIdentityMismatches.push("packages/dsh-adapter/package.json#name");
}
if (adapterManifest.dependencies?.["@domaineval/weave"] !== "workspace:*") {
  publicIdentityMismatches.push("packages/dsh-adapter/package.json#dependencies");
}
if (rootManifest.name !== "domain-eval-weave-workspace" || rootManifest.private !== true) {
  publicIdentityMismatches.push("package.json#workspace-identity");
}
if (
  legacyManifest.name !== "dsh-eval-lab" ||
  legacyManifest.repository?.directory !== "legacy/dsh-eval-lab"
) {
  publicIdentityMismatches.push("legacy/dsh-eval-lab/package.json#identity");
}
if (
  !rootReadme.startsWith("# DomainEval Weave\n") ||
  !rootReadme.includes("Make domain truth executable.")
) {
  publicIdentityMismatches.push("README.md#public-identity");
}
const status = JSON.parse(
  await readFile(resolve(repositoryRoot, ".github/open-source-status.json"), "utf8"),
);
if (
  status.schema_version !== 1 ||
  !["unselected", "apache-2.0-code_cc0-synthetic", "mit-code_cc0-synthetic"].includes(
    status.license,
  ) ||
  !["pending", "complete"].includes(status.remote_ci) ||
  !["pending", "complete"].includes(status.human_cleanroom)
) {
  throw new Error("open-source status contains an unsupported transition");
}
const licenseFiles = [
  "LICENSE",
  "packages/weave/LICENSE",
  "packages/dsh-adapter/LICENSE",
  "packages/weave/examples/commerce-cancellation/sources/LICENSE",
];
const missingLicenseFiles = [];
if (status.license !== "unselected") {
  for (const path of licenseFiles) {
    try {
      await access(resolve(repositoryRoot, path));
    } catch {
      missingLicenseFiles.push(path);
    }
  }
  for (const path of [
    "packages/weave/package.json",
    "packages/dsh-adapter/package.json",
    "legacy/dsh-eval-lab/package.json",
  ]) {
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
    const expected = status.license.startsWith("apache") ? "Apache-2.0" : "MIT";
    if (manifest.license !== expected) missingLicenseFiles.push(`${path}#license`);
  }
}
const publicRepositoryHygiene = [];
for (const path of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "KIMI.md"]) {
  if ((await lstat(resolve(repositoryRoot, path)).catch(() => undefined)) !== undefined) {
    publicRepositoryHygiene.push(`${path}#provider-shim`);
  }
}
for (const path of [
  "bin",
  "contracts",
  "cordis.patch.yml",
  "eval-packs",
  "examples",
  "harnesses",
  "registry",
  "runtime-profile",
  "skills",
  "src",
  "task-packs",
  "variants",
  "tsconfig.json",
  "tsconfig.test.json",
]) {
  if ((await lstat(resolve(repositoryRoot, path)).catch(() => undefined)) !== undefined) {
    publicRepositoryHygiene.push(`${path}#legacy-root-leak`);
  }
}
const workflow = await readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
if (/\/Users\/slipshod|Initialize isolated legacy runtime/.test(workflow)) {
  publicRepositoryHygiene.push(".github/workflows/ci.yml#internal-environment");
}
if (
  !workflow.includes("pnpm install --frozen-lockfile --ignore-scripts") ||
  !workflow.includes("pnpm check:public && pnpm lint:public") ||
  !workflow.includes("pnpm test:public") ||
  !workflow.includes("pnpm build:packages")
) {
  publicRepositoryHygiene.push(".github/workflows/ci.yml#public-gate");
}
const contributing = await readFile(resolve(repositoryRoot, "CONTRIBUTING.md"), "utf8");
if (!contributing.includes("pnpm test:public")) {
  publicRepositoryHygiene.push("CONTRIBUTING.md#public-gate");
}
if (
  typeof rootManifest.scripts?.["check:public"] !== "string" ||
  typeof rootManifest.scripts?.["lint:public"] !== "string" ||
  typeof rootManifest.scripts?.["test:public"] !== "string"
) {
  publicRepositoryHygiene.push("package.json#public-gate");
}
if (
  (await lstat(resolve(repositoryRoot, "cat-cafe-skills")).catch(() => undefined)) !== undefined
) {
  publicRepositoryHygiene.push("cat-cafe-skills#internal-link");
}
const blockers = [
  ...missing.map((path) => `IMPLEMENTATION_FILE_MISSING:${path}`),
  ...publicIdentityMismatches.map((path) => `PUBLIC_IDENTITY_MISMATCH:${path}`),
  ...(status.license === "unselected" ? ["LICENSE_UNSELECTED"] : []),
  ...missingLicenseFiles.map((path) => `LICENSE_EVIDENCE_MISSING:${path}`),
  ...publicRepositoryHygiene.map((path) => `PUBLIC_REPOSITORY_HYGIENE:${path}`),
  ...(status.remote_ci === "pending" ? ["REMOTE_CI_PENDING"] : []),
  ...(status.human_cleanroom === "pending" ? ["HUMAN_CLEANROOM_PENDING"] : []),
];
const implementationReady =
  missing.length === 0 &&
  publicIdentityMismatches.length === 0 &&
  publicRepositoryHygiene.length === 0;
const developerPreviewReady =
  implementationReady &&
  status.license !== "unselected" &&
  missingLicenseFiles.length === 0 &&
  status.remote_ci === "complete";
const publicAlphaReady = developerPreviewReady && status.human_cleanroom === "complete";
process.stdout.write(
  `${JSON.stringify(
    {
      schema_version: 1,
      implementation_ready: implementationReady,
      developer_preview_ready: developerPreviewReady,
      public_alpha_ready: publicAlphaReady,
      blockers,
    },
    null,
    2,
  )}\n`,
);
if (process.argv.includes("--require-preview") && !developerPreviewReady) process.exitCode = 3;
