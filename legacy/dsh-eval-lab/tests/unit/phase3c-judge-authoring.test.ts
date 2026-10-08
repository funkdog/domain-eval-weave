import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson } from "../../src/contracts/canonical-json.js";
import { freezeDefaultJudgeDefinitions, parseJudgeFreezeReceipt } from "../../src/phase3c/index.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const sha = (value: string) => value.repeat(64);

function inputSet(kind: "semantic" | "code_quality", setKind: "locked_admission" | "locked_bias") {
  const prefix = `${kind}-${setKind}`;
  return {
    schema_version: 1 as const,
    set_id: prefix,
    judge_kind: kind,
    set_kind: setKind,
    cases: [
      {
        case_id: `${prefix}-case`,
        input_closure_sha256: sha(
          kind === "semantic"
            ? setKind === "locked_admission"
              ? "1"
              : "2"
            : setKind === "locked_admission"
              ? "3"
              : "4",
        ),
        risk_class: "critical" as const,
        canonical_case_id: setKind === "locked_bias" ? `${kind}-locked_admission-case` : null,
        transform_id: setKind === "locked_bias" ? "identifier" : null,
      },
    ],
  };
}

test("Judge authoring atomically freezes versioned definitions before locked execution manifests", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/judge-authoring-`);
  const curationRoot = `${root}/curation`;
  const setsRoot = `${curationRoot}/sets`;
  const outputRoot = `${root}/authoring`;
  await mkdir(setsRoot, { recursive: true, mode: 0o700 });
  const sets = [
    ["semantic-locked_admission-v1.json", inputSet("semantic", "locked_admission")],
    ["semantic-locked_bias-v1.json", inputSet("semantic", "locked_bias")],
    ["code_quality-locked_admission-v1.json", inputSet("code_quality", "locked_admission")],
    ["code_quality-locked_bias-v1.json", inputSet("code_quality", "locked_bias")],
  ] as const;
  for (const [name, value] of sets) {
    await writeFile(`${setsRoot}/${name}`, canonicalJson(value), { mode: 0o600 });
  }
  try {
    const manifest = await freezeDefaultJudgeDefinitions({
      curationRoot,
      outputRoot,
      semanticOutputSchemaBytes: '{"type":"object"}',
      codeQualityOutputSchemaBytes: '{"type":"object"}',
      frozenAt: "2026-08-25T00:00:00.000Z",
    });
    assert.equal(manifest.bundle_id, "phase3c-judge-authoring-v5");
    assert.equal(manifest.semantic.definition_version, "phase3c-semantic-definition-v5");
    assert.equal(manifest.code_quality.definition_version, "phase3c-code-quality-definition-v5");
    const freeze = parseJudgeFreezeReceipt(
      JSON.parse(await readFile(`${outputRoot}/semantic/freeze-receipt.json`, "utf8")),
    );
    assert.equal(freeze.frozen_at, "2026-08-25T00:00:00.000Z");
    assert.equal((await stat(`${outputRoot}/semantic/prompt.txt`)).mode & 0o777, 0o600);
    await assert.rejects(
      freezeDefaultJudgeDefinitions({
        curationRoot,
        outputRoot,
        semanticOutputSchemaBytes: '{"type":"object"}',
        codeQualityOutputSchemaBytes: '{"type":"object"}',
        frozenAt: "2026-08-25T00:00:00.000Z",
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
