import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = await realpath(fileURLToPath(new URL("..", import.meta.url)));
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
  if (
    entry.isSymbolicLink() ||
    (path === source ? !entry.isFile() : !entry.isDirectory())
  ) {
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
  packages: "external",
  legalComments: "none",
  sourcemap: false,
});

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
