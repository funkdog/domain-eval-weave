import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../src/contracts/canonical-json.js";
import { freezeDefaultJudgeDefinitions } from "../src/phase3c/judge-authoring.js";

const rawArguments = process.argv.slice(2);
const positionalArguments = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
const [curationRoot, outputRoot, frozenAt = new Date().toISOString()] = positionalArguments;
if (curationRoot === undefined || outputRoot === undefined) {
  throw new Error("usage: freeze-phase3c-judges <curation-root> <output-root> [frozen-at]");
}

const contractsRoot = fileURLToPath(new URL("../contracts/phase3c/", import.meta.url));
const [semanticOutputSchemaBytes, codeQualityOutputSchemaBytes] = await Promise.all([
  readFile(`${contractsRoot}/semantic-judge-run-result.schema.json`, "utf8"),
  readFile(`${contractsRoot}/code-quality-judge-run-result.schema.json`, "utf8"),
]);
const manifest = await freezeDefaultJudgeDefinitions({
  curationRoot,
  outputRoot,
  semanticOutputSchemaBytes,
  codeQualityOutputSchemaBytes,
  frozenAt,
});
process.stdout.write(`${canonicalJson(manifest)}\n`);
