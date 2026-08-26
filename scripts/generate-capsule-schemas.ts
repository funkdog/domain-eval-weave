import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import {
  calibrationCaseSchema,
  capsuleDomainSchema,
  capsuleManifestSchema,
  evaluationRunSchema,
  evaluatorPackageSchema,
  requirementDeltaSchema,
} from "../src/capsule/contracts.js";

const outputRoot = new URL("../contracts/capsule/", import.meta.url);
const execFileAsync = promisify(execFile);
const schemas = {
  "capsule-manifest": capsuleManifestSchema,
  "domain-contract": capsuleDomainSchema,
  "requirement-delta": requirementDeltaSchema,
  "evaluator-package": evaluatorPackageSchema,
  "calibration-case": calibrationCaseSchema,
  "evaluation-run": evaluationRunSchema,
} as const;

await mkdir(outputRoot, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const generated = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  await writeFile(
    new URL(`${name}.schema.json`, outputRoot),
    `${JSON.stringify(
      {
        ...generated,
        $id: `https://dsh-eval-lab.local/contracts/capsule/${name}.schema.json`,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

await execFileAsync(process.execPath, [
  fileURLToPath(new URL("../node_modules/@biomejs/biome/bin/biome", import.meta.url)),
  "format",
  "--write",
  fileURLToPath(outputRoot),
]);
