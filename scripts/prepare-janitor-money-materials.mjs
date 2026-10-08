import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../packages/weave/src/capsule/artifact-store.ts";
import { renderDomainProse, verifyDomainProse } from "./lib/domain-prose-material.mjs";

// Trusted, model-free material preparation. No consumer workspace or launch is authorized here.
assert.equal(process.argv.length, 2, "no input/output path overrides");
const source = fileURLToPath(
  new URL("../packages/weave/examples/killbill-orchestration/", import.meta.url),
);
const asset = new URL(
  "../packages/weave/examples/killbill-janitor-money-acceptance/",
  import.meta.url,
);
async function physical(path) {
  assert.equal(await realpath(path), resolve(path), "symlink source denied");
  const st = await lstat(path);
  assert.ok(st.isFile() && st.nlink === 1 && st.size < 32 * 1024 * 1024);
  return readFile(path);
}
const lock = JSON.parse(await physical(join(source, "release.lock.json")));
assert.equal(
  lock.module_digest,
  "b4197c43db0d393e480d12874ce76c0db6d9c51187c99a4c6e4b009fa718d215",
);
const files = {};
for (const [name, sha] of Object.entries(lock.files)) {
  assert.ok(name.split("/").every((s) => s && s !== "." && s !== ".."));
  const bytes = await physical(join(source, name));
  assert.equal(sha256Hex(bytes), sha, `source drift: ${name}`);
  files[name] = bytes;
}
const document = parseDocument(files["module.yaml"].toString("utf8"), { uniqueKeys: true });
assert.deepEqual(document.errors, []);
const module = document.toJS();
const rendered = renderDomainProse(module);
verifyDomainProse(module, rendered);
const sanctuary = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
assert.equal(await realpath(sanctuary), sanctuary);
const root = await mkdtemp(join(sanctuary, "janitor-money-materials."));
const output = {};
async function put(name, data) {
  const bytes = Buffer.from(data);
  await mkdir(dirname(join(root, name)), { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(
    join(root, name),
    bytes,
    () => new Error("immutable material collision"),
  );
  output[name] = sha256Hex(bytes);
}
// Common original human models and source snapshots; only module presentation differs.
const common = Object.keys(files).filter(
  (name) => name.startsWith("docs/") || name.startsWith("sources/"),
);
for (const arm of ["a", "b"]) {
  for (const name of common) await put(`${arm}/knowledge/${name}`, files[name]);
  await put(`${arm}/TASK.md`, await readFile(new URL("TASK.md", asset)));
}
await put("a/knowledge/module.md", rendered.markdown);
await put("b/knowledge/module.yaml", files["module.yaml"]);
verifyDomainProse(module, {
  ...rendered,
  markdown: await readFile(join(root, "a/knowledge/module.md"), "utf8"),
});
for (const name of common)
  assert.equal(output[`a/knowledge/${name}`], output[`b/knowledge/${name}`]);
assert.equal(output["a/TASK.md"], output["b/TASK.md"]);
await put(
  "control/prose-inventory.json",
  `${canonicalJson({
    source_module_sha256: lock.files["module.yaml"],
    inventory: rendered.inventory,
    spans: rendered.spans,
    offset_unit: rendered.offset_unit,
  })}\n`,
);
const receipt = {
  format: "janitor-money-materials-v1",
  root,
  module_digest: lock.module_digest,
  source_lock_sha256: sha256Hex(await physical(join(source, "release.lock.json"))),
  source_files: lock.files,
  output_files: output,
  renderer_sha256: sha256Hex(
    await readFile(new URL("./lib/domain-prose-material.mjs", import.meta.url)),
  ),
  preparer_sha256: sha256Hex(await readFile(new URL(import.meta.url))),
  node_count: rendered.inventory.length,
  prose_characters: rendered.markdown.length,
  yaml_bytes: files["module.yaml"].length,
  compared_surface: "static_module_presentation_with_identical_human_models_and_sources",
  mechanical_coverage: "verified",
  independent_semantic_review: "pending",
  excluded_from_both: ["README.md", "landscape.yaml", "release.lock.json"],
  exclusion_reason:
    "Original package operation/discovery instructions are not the comparison treatment; their source pins remain in this control receipt.",
  consumer_workspace_ready: false,
  models_run: 0,
  qualification: "not_qualified",
};
const result = { ...receipt, digest: canonicalJsonDigest(receipt) };
await put("control/materials.json", `${canonicalJson(result)}\n`);
console.log(
  JSON.stringify({
    root,
    digest: result.digest,
    node_count: result.node_count,
    common_files_per_arm: common.length + 1,
    mechanical_coverage: result.mechanical_coverage,
    independent_semantic_review: "pending",
    models_run: 0,
    qualification: "not_qualified",
  }),
);
