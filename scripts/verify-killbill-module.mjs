import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { canonicalJsonDigest, sha256Hex } from "../packages/weave/src/canonical-json.ts";
import { compileDomainLandscapeDirectory } from "../packages/weave/src/domain/compiler.ts";

const args = process.argv.slice(2);
const printLock = args.includes("--print-lock");
const roots = args.filter((arg) => arg !== "--print-lock");
if (roots.length > 1 || roots.some((arg) => arg.startsWith("--"))) {
  throw new Error(
    "Usage: node --import tsx scripts/verify-killbill-module.mjs [package-directory] [--print-lock]",
  );
}
const root = resolve(
  roots[0] ??
    fileURLToPath(new URL("../packages/weave/examples/killbill-orchestration", import.meta.url)),
);
const compiled = await compileDomainLandscapeDirectory(root);
assert.deepEqual(
  await compileDomainLandscapeDirectory(root),
  compiled,
  "compilation must be deterministic",
);
assert.equal(compiled.modules.length, 1);
const module = compiled.modules[0];
assert.equal(module.moduleId, "payments.orchestration.killbill");
assert.ok(module.model, "fields and flows must survive compilation");
const raw = parse(await readFile(resolve(root, "module.yaml"), "utf8"));
assert.deepEqual(module.model, raw.model);
assert.deepEqual(
  compiled.claims.map((claim) => claim.statement),
  [...raw.claims]
    .sort((a, b) => a.claim_id.localeCompare(b.claim_id))
    .map((claim) => claim.statement),
);
assert.equal(compiled.claims.filter((claim) => claim.epistemicState === "confirmed").length, 0);

let sourceFileCount = 0;
for (const source of compiled.sourceSnapshots) {
  const bundle = JSON.parse(await readFile(resolve(root, "sources", source.path), "utf8"));
  assert.match(bundle.revision, /^[0-9a-f]{40}$/);
  assert.equal(bundle.license, "Apache-2.0");
  assert.ok(bundle.files.some((file) => file.path === "LICENSE"));
  for (const file of bundle.files) {
    const bytes = Buffer.from(file.content, "utf8");
    const gitBlob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(bytes.length, file.byte_length, `${source.sourceId}:${file.path} bytes`);
    assert.equal(gitBlob, file.git_blob_sha1, `${source.sourceId}:${file.path} Git blob`);
    sourceFileCount++;
  }
}

const files = {};
async function inventory(relative = "") {
  for (const name of (await readdir(resolve(root, relative))).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    if (path === "release.lock.json") continue;
    const stat = await lstat(resolve(root, path));
    assert.ok(!stat.isSymbolicLink(), `symlink in candidate package: ${path}`);
    if (stat.isDirectory()) await inventory(path);
    else {
      assert.ok(stat.isFile(), `non-file in candidate package: ${path}`);
      files[path] = sha256Hex(await readFile(resolve(root, path)));
    }
  }
}
await inventory();
const lock = {
  schema_version: "killbill-candidate-lock-v1",
  lifecycle: "candidate",
  module_id: module.moduleId,
  version: module.version,
  module_digest: module.contentSha256,
  compilation_digest: compiled.digest,
  compiled_content_sha256: canonicalJsonDigest(compiled),
  counts: {
    concepts: module.concepts.length,
    fields: module.model.structures.reduce(
      (count, structure) => count + structure.fields.length,
      0,
    ),
    states: module.model.states.length,
    transitions: module.model.transitions.length,
    flows: module.model.flows.length,
    model_documents: module.modelDocuments.length,
    grounded_claims: compiled.claims.filter((claim) => claim.epistemicState === "grounded").length,
    unknown_claims: compiled.claims.filter((claim) => claim.epistemicState === "unknown").length,
    source_files: sourceFileCount,
  },
  files,
};
if (printLock) console.log(JSON.stringify(lock, null, 2));
else {
  const expected = JSON.parse(await readFile(resolve(root, "release.lock.json"), "utf8"));
  assert.deepEqual(lock, expected, "candidate content changed: review changes before repinning");
  console.log(JSON.stringify({ status: "verified-candidate", ...lock }, null, 2));
}
