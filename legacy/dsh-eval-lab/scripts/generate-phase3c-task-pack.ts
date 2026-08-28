import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../src/contracts/canonical-json.js";
import { PHASE3C_PUBLIC_OBSERVATION_CATALOG } from "../src/phase3c/vocabulary.js";
import { digestDirectory } from "../src/task-pack/loader.js";

const packRoot = fileURLToPath(
  new URL("../task-packs/open-coding-ts-commerce-order-v3/", import.meta.url),
);
const packPath = `${packRoot}/pack.json`;
const current = JSON.parse(await readFile(packPath, "utf8")) as Record<string, unknown>;
const [baseTreeSha256, calibrationDigest] = await Promise.all([
  digestDirectory(`${packRoot}/base`),
  digestDirectory(`${packRoot}/calibration`),
]);
const pack = {
  ...current,
  base_tree_sha256: baseTreeSha256,
  calibration_digest: calibrationDigest,
};
await Promise.all([
  writeFile(packPath, `${canonicalJson(pack)}\n`, "utf8"),
  writeFile(
    `${packRoot}/public-observation-catalog.json`,
    `${canonicalJson(PHASE3C_PUBLIC_OBSERVATION_CATALOG)}\n`,
    "utf8",
  ),
]);
