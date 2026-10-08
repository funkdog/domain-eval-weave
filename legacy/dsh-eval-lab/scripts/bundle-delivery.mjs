import { cp, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const workspacePackages = ["@domaineval/weave", "@domaineval/dsh-adapter"];

function isWorkspaceImport(specifier) {
  return workspacePackages.some(
    (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`),
  );
}

const bundleWorkspacePackages = {
  name: "bundle-domain-eval-workspaces",
  setup(context) {
    context.onResolve({ filter: /^[^./]/ }, (args) =>
      isWorkspaceImport(args.path) ? undefined : { path: args.path, external: true },
    );
  },
};

const repositoryRoot = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = await realpath(resolve(repositoryRoot, "../.."));
const weaveRoot = resolve(workspaceRoot, "packages/weave");
const source = resolve(repositoryRoot, "src/delivery/production.ts");
const deliveryRoot = resolve(repositoryRoot, "dist/delivery");
const output = resolve(deliveryRoot, "production.js");

if (
  dirname(deliveryRoot) !== resolve(repositoryRoot, "dist") ||
  basename(deliveryRoot) !== "delivery" ||
  dirname(output) !== deliveryRoot ||
  basename(output) !== "production.js"
) {
  throw new Error("refusing to bundle outside the exact dist/delivery production target");
}
for (const path of [repositoryRoot, source, deliveryRoot]) {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || (path === source ? !entry.isFile() : !entry.isDirectory())) {
    throw new Error("delivery bundler requires physical source and output paths");
  }
}

await build({
  entryPoints: [source],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  plugins: [bundleWorkspacePackages],
  legalComments: "none",
  sourcemap: false,
});

await build({
  entryPoints: {
    "contracts/canonical-json": resolve(weaveRoot, "src/canonical-json.ts"),
    "capsule/index": resolve(weaveRoot, "src/capsule/index.ts"),
    "capsule-cli/index": resolve(weaveRoot, "src/cli/index.ts"),
    "evaluator/index": resolve(weaveRoot, "src/evaluator/index.ts"),
    "harness/index": resolve(weaveRoot, "src/harness/index.ts"),
  },
  outdir: resolve(repositoryRoot, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  plugins: [bundleWorkspacePackages],
  legalComments: "none",
  sourcemap: false,
});

const weaveDeclarationRoot = resolve(weaveRoot, "dist/types/packages/weave/src");
for (const [sourceName, targetName] of [
  ["capsule", "capsule"],
  ["cli", "capsule-cli"],
  ["evaluator", "evaluator"],
  ["harness", "harness"],
]) {
  await cp(resolve(weaveDeclarationRoot, sourceName), resolve(repositoryRoot, "dist", targetName), {
    recursive: true,
    force: true,
  });
}
await cp(
  resolve(weaveDeclarationRoot, "canonical-json.d.ts"),
  resolve(repositoryRoot, "dist/contracts/canonical-json.d.ts"),
  { force: true },
);

for (const moduleName of ["admission", "artifacts", "compiler", "report"]) {
  for (const extension of ["js", "js.map", "d.ts"]) {
    await rm(resolve(deliveryRoot, `${moduleName}.${extension}`), { force: true });
  }
}
await rm(resolve(deliveryRoot, "production.js.map"), { force: true });

const commerceRoot = resolve(repositoryRoot, "dist/commerce");
if (
  dirname(commerceRoot) !== resolve(repositoryRoot, "dist") ||
  basename(commerceRoot) !== "commerce"
) {
  throw new Error("refusing to prune outside the exact dist/commerce target");
}
for (const moduleName of [
  "admission",
  "campaign",
  "campaign-contracts",
  "campaign-report",
  "compiler",
  "delivery-artifacts",
  "delivery-contracts",
  "delivery-report",
  "production",
  "real-campaign",
  "replay",
  "validity",
]) {
  for (const extension of ["js", "js.map", "d.ts"]) {
    await rm(resolve(commerceRoot, `${moduleName}.${extension}`), { force: true });
  }
}

await build({
  entryPoints: {
    "adapters/index": resolve(repositoryRoot, "src/adapters/index.ts"),
    "adapters/commerce-observation": resolve(
      repositoryRoot,
      "src/adapters/commerce-observation.ts",
    ),
    "adapters/dsh-harness": resolve(repositoryRoot, "src/adapters/dsh-harness.ts"),
    "adapters/raw-dsh-events": resolve(repositoryRoot, "src/adapters/raw-dsh-events.ts"),
    "phase3c/tdd-binding": resolve(repositoryRoot, "src/phase3c/tdd-binding.ts"),
  },
  outdir: resolve(repositoryRoot, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  plugins: [bundleWorkspacePackages],
  legalComments: "none",
  sourcemap: false,
});

const adapterDeclarationRoot = resolve(workspaceRoot, "packages/dsh-adapter/dist");
const legacyAdapterDeclarationRoot = resolve(repositoryRoot, "dist/adapters");
for (const moduleName of [
  "commerce-observation",
  "dsh-harness",
  "index",
  "raw-dsh-events",
  "tdd",
]) {
  const source = await readFile(resolve(adapterDeclarationRoot, `${moduleName}.d.ts`), "utf8");
  const rewritten = source
    .replaceAll('"@domaineval/weave/capsule"', '"../capsule/index.js"')
    .replaceAll('"@domaineval/weave/harness"', '"../harness/index.js"');
  await writeFile(resolve(legacyAdapterDeclarationRoot, `${moduleName}.d.ts`), rewritten, "utf8");
}
await writeFile(
  resolve(repositoryRoot, "dist/phase3c/tdd-binding.d.ts"),
  await readFile(resolve(adapterDeclarationRoot, "tdd.d.ts"), "utf8"),
  "utf8",
);

const commerceWithdrawalRoot = resolve(repositoryRoot, "dist/commerce-withdrawal");
if (
  dirname(commerceWithdrawalRoot) !== resolve(repositoryRoot, "dist") ||
  basename(commerceWithdrawalRoot) !== "commerce-withdrawal"
) {
  throw new Error("refusing to prune outside the exact dist/commerce-withdrawal target");
}
for (const moduleName of [
  "admission",
  "campaign",
  "campaign-contracts",
  "campaign-report",
  "compiler",
  "delivery-artifacts",
  "delivery-contracts",
  "delivery-report",
  "production",
  "real-campaign",
  "replay",
  "validity",
]) {
  for (const extension of ["js", "js.map", "d.ts"]) {
    await rm(resolve(commerceWithdrawalRoot, `${moduleName}.${extension}`), { force: true });
  }
}
