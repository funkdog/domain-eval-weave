import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse, stringify } from "yaml";

import { canonicalJsonDigest, sha256Hex } from "../../src/canonical-json.js";
import { compileDomainLandscapeDirectory } from "../../src/domain/compiler.js";

const example = new URL("../../examples/killbill-orchestration/", import.meta.url);

async function withCopy(run: (root: string) => Promise<void>) {
  const runtime = process.env.DSH_EVAL_RUNTIME_ROOT ?? tmpdir();
  await mkdir(runtime, { recursive: true });
  const parent = await mkdtemp(join(runtime, "killbill-module-test-"));
  try {
    const root = join(parent, "module");
    await cp(example, root, { recursive: true });
    await run(root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test("Kill Bill candidate compiles without losing fields, flows, sources or claim statements", async () => {
  const raw = parse(await readFile(new URL("module.yaml", example), "utf8"));
  const compiled = await compileDomainLandscapeDirectory(fileURLToPath(example));
  assert.equal(compiled.moduleReleaseCount, 1);
  assert.equal(compiled.mappingCount, 0);
  assert.equal(compiled.claims.length, 16);
  assert.equal(compiled.claims.filter((claim) => claim.epistemicState === "unknown").length, 4);
  assert.equal(compiled.claims.filter((claim) => claim.epistemicState === "confirmed").length, 0);
  assert.deepEqual(compiled.modules[0]?.model, raw.model);
  assert.equal(compiled.modules[0]?.modelDocuments?.length, 5);
  for (const document of compiled.modules[0]?.modelDocuments ?? []) {
    assert.equal(sha256Hex(document.content), document.contentSha256);
  }
  assert.equal(compiled.modules[0]?.model?.structures.length, 7);
  assert.equal(compiled.modules[0]?.model?.transitions.length, 51);
  assert.equal(compiled.modules[0]?.model?.flows.length, 6);
  assert.equal(compiled.claims[0]?.statement, raw.claims[0].statement);
  assert.deepEqual(await compileDomainLandscapeDirectory(fileURLToPath(example)), compiled);
  for (const source of compiled.sourceSnapshots) {
    const bytes = await readFile(new URL(`sources/${source.path}`, example));
    assert.equal(sha256Hex(bytes), source.contentSha256);
    const bundle = JSON.parse(bytes.toString("utf8"));
    assert.match(bundle.revision, /^[0-9a-f]{40}$/);
    assert.ok(bundle.files.some((file: { path: string }) => file.path === "LICENSE"));
  }
});

test("Kill Bill source tampering is refused before compilation", async () => {
  await withCopy(async (root) => {
    await writeFile(join(root, "sources/core.json"), "{}\n");
    await assert.rejects(compileDomainLandscapeDirectory(root), {
      code: "source_content_digest_mismatch",
    });
  });
});

test("Kill Bill operation graph matches the pinned upstream XML rather than a handwritten count", async () => {
  const raw = parse(await readFile(new URL("module.yaml", example), "utf8"));
  const bundle = JSON.parse(await readFile(new URL("sources/core.json", example), "utf8"));
  const xml: string = bundle.files.find((file: { path: string }) =>
    file.path.endsWith("/PaymentStates.xml"),
  ).content;
  const active = new Set(["AUTHORIZE", "CAPTURE", "PURCHASE", "CREDIT", "REFUND", "VOID"]);
  const triples: string[] = [];
  const tag = (text: string, name: string) =>
    text.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
  for (const machine of xml.matchAll(/<stateMachine name="([^"]+)">([\s\S]*?)<\/stateMachine>/g)) {
    if (!active.has(machine[1] ?? "")) continue;
    for (const transition of (machine[2] ?? "").matchAll(/<transition>([\s\S]*?)<\/transition>/g)) {
      const text = transition[1] ?? "";
      triples.push(
        `${tag(text, "initialState")}:${tag(text, "operationResult")}:${tag(text, "finalState")}`,
      );
    }
  }
  for (const link of xml.matchAll(/<linkStateMachine>([\s\S]*?)<\/linkStateMachine>/g)) {
    const text = link[1] ?? "";
    if (
      !active.has(tag(text, "finalStateMachine") ?? "") ||
      !new Set([...active, "BIG_BANG"]).has(tag(text, "initialStateMachine") ?? "")
    )
      continue;
    triples.push(`${tag(text, "initialState")}:NEXT_OPERATION:${tag(text, "finalState")}`);
  }
  assert.deepEqual(
    raw.model.transitions
      .map(
        (transition: { from: string; to: string; trigger: string }) =>
          `${transition.from}:${transition.trigger}:${transition.to}`,
      )
      .sort(),
    triples.sort(),
  );
});

test("Kill Bill compiled field shapes preserve the human model declarations", async () => {
  const compiled = await compileDomainLandscapeDirectory(fileURLToPath(example));
  const model = compiled.modules[0]?.model;
  assert.ok(model);
  const human = await readFile(
    new URL("docs/killbill-payment-orchestration-semantic-model.md", example),
    "utf8",
  );
  for (const structure of model.structures) {
    const block = human.match(new RegExp(`\\b${structure.concept_ref} \\{\\n([\\s\\S]*?)\\n\\}`));
    assert.ok(block, structure.concept_ref);
    const declared = [...(block[1] ?? "").matchAll(/^\s+(\w+)(\?)?: (.+)$/gm)].map((match) => ({
      name: match[1],
      type: match[3]?.replace(/\?$/, ""),
      nullable: !!match[2] || !!match[3]?.endsWith("?"),
    }));
    assert.deepEqual(
      structure.fields.map(({ name, type, nullable }) => ({ name, type, nullable })),
      declared,
      structure.concept_ref,
    );
    assert.ok(structure.fields.every((field) => field.description.trim().length > 0));
  }
});

test("Kill Bill human model changes cannot bypass document pins", async () => {
  await withCopy(async (root) => {
    const path = join(root, "docs/killbill-payment-orchestration-semantic-model.md");
    await writeFile(path, `${await readFile(path, "utf8")}\nChanged definition.\n`);
    await assert.rejects(compileDomainLandscapeDirectory(root), {
      code: "model_document_digest_mismatch",
    });
  });
});

test("Kill Bill structured model rejects missing concepts and unknown transition states", async () => {
  for (const target of ["owner", "state"] as const) {
    await withCopy(async (root) => {
      const module = parse(await readFile(join(root, "module.yaml"), "utf8"));
      if (target === "owner") module.model.structures[0].owner_ref = "MissingConcept";
      else module.model.transitions[0].to = "MissingState";
      await writeFile(join(root, "module.yaml"), stringify(module));
      const envelope = parse(await readFile(join(root, "landscape.yaml"), "utf8"));
      envelope.module_releases[0].content_sha256 = canonicalJsonDigest(module);
      await writeFile(join(root, "landscape.yaml"), stringify(envelope));
      await assert.rejects(compileDomainLandscapeDirectory(root), {
        code: "unknown_model_reference",
      });
    });
  }
});

test("Kill Bill model changes alter its pinned digest and retained compiled content", async () => {
  const baseline = await compileDomainLandscapeDirectory(fileURLToPath(example));
  await withCopy(async (root) => {
    const module = parse(await readFile(join(root, "module.yaml"), "utf8"));
    module.model.structures[0].fields[0].description += " Clarified.";
    await writeFile(join(root, "module.yaml"), stringify(module));
    await assert.rejects(compileDomainLandscapeDirectory(root), {
      code: "module_content_digest_mismatch",
    });
    const envelope = parse(await readFile(join(root, "landscape.yaml"), "utf8"));
    envelope.module_releases[0].content_sha256 = canonicalJsonDigest(module);
    await writeFile(join(root, "landscape.yaml"), stringify(envelope));
    const changed = await compileDomainLandscapeDirectory(root);
    assert.notEqual(changed.digest, baseline.digest);
    assert.deepEqual(changed.modules[0]?.model, module.model);
  });
});
