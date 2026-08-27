import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const required = [
  "packages/lab/package.json",
  "packages/dsh-adapter/package.json",
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
const status = JSON.parse(
  await readFile(resolve(repositoryRoot, "open-source-status.json"), "utf8"),
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
  "packages/lab/LICENSE",
  "packages/dsh-adapter/LICENSE",
  "examples/capsules/commerce-cancellation/sources/LICENSE",
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
  for (const path of ["packages/lab/package.json", "packages/dsh-adapter/package.json"]) {
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
    const expected = status.license.startsWith("apache") ? "Apache-2.0" : "MIT";
    if (manifest.license !== expected) missingLicenseFiles.push(`${path}#license`);
  }
}
const blockers = [
  ...missing.map((path) => `IMPLEMENTATION_FILE_MISSING:${path}`),
  ...(status.license === "unselected" ? ["LICENSE_UNSELECTED"] : []),
  ...missingLicenseFiles.map((path) => `LICENSE_EVIDENCE_MISSING:${path}`),
  ...(status.remote_ci === "pending" ? ["REMOTE_CI_PENDING"] : []),
  ...(status.human_cleanroom === "pending" ? ["HUMAN_CLEANROOM_PENDING"] : []),
];
const implementationReady = missing.length === 0;
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
