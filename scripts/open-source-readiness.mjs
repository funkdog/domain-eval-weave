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
const status = JSON.parse(await readFile(resolve(repositoryRoot, "open-source-status.json"), "utf8"));
const blockers = [
  ...missing.map((path) => `IMPLEMENTATION_FILE_MISSING:${path}`),
  ...(status.license === "unselected" ? ["LICENSE_UNSELECTED"] : []),
  ...(status.human_cleanroom === "pending" ? ["HUMAN_CLEANROOM_PENDING"] : []),
];
const implementationReady = missing.length === 0;
const developerPreviewReady = implementationReady && status.license !== "unselected";
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
