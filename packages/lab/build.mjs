import { execFile } from "node:child_process";
import { cp, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const packageRoot = await realpath(fileURLToPath(new URL(".", import.meta.url)));
const repositoryRoot = await realpath(resolve(packageRoot, "../.."));
const distRoot = resolve(packageRoot, "dist");
if (dirname(distRoot) !== packageRoot || basename(distRoot) !== "dist") {
  throw new Error("refusing to build outside the Lab package dist directory");
}
try {
  const entry = await lstat(distRoot);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("Lab dist output must be one physical directory");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true, mode: 0o700 });

await build({
  absWorkingDir: packageRoot,
  entryPoints: {
    index: "src/index.ts",
    capsule: "src/capsule.ts",
    evaluator: "src/evaluator.ts",
    harness: "src/harness.ts",
    cli: "src/cli.ts",
    "canonical-json": "src/canonical-json.ts",
  },
  outdir: distRoot,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  external: ["yaml", "zod"],
  legalComments: "none",
  sourcemap: false,
});

const typescriptModule = createRequire(import.meta.url).resolve("typescript");
const typescriptCli = resolve(dirname(typescriptModule), "../bin/tsc");
await execFileAsync(
  process.execPath,
  [typescriptCli, "-p", resolve(packageRoot, "tsconfig.types.json")],
  {
    cwd: repositoryRoot,
    maxBuffer: 16 * 1024 * 1024,
  },
);

await Promise.all([
  cp(resolve(repositoryRoot, "contracts/capsule"), resolve(distRoot, "contracts"), {
    recursive: true,
    force: false,
    errorOnExist: true,
  }),
  cp(
    resolve(repositoryRoot, "examples/capsules/commerce-cancellation"),
    resolve(distRoot, "examples/commerce-cancellation"),
    { recursive: true, force: false, errorOnExist: true },
  ),
]);
