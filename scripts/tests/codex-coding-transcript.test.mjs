import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../packages/weave/src/canonical-json.ts";
import { cliArgs, validateNativeTranscript } from "../lib/codex-coding-harness.mjs";

const root = process.env.CODEX_PREFLIGHT_ROOT;
assert.ok(root, "set CODEX_PREFLIGHT_ROOT to a retained model-free native preflight");
const launch = JSON.parse(await readFile(join(root, "launch.json"), "utf8"));
const result = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
assert.equal(result.status, "bounded_native_isolation_verified");
const sessionRoot = join(launch.codexHome, "sessions");
const files = (await readdir(sessionRoot, { recursive: true })).filter((path) =>
  path.endsWith(".jsonl"),
);
assert.equal(files.length, 1);
const raw = await readFile(join(sessionRoot, files[0]), "utf8");
const expected = {
  workspace: launch.workspace,
  authHome: launch.codexHome,
  config: launch.config,
  pins: launch.pins,
  prompt: launch.args.at(-1),
};

test("launch arguments survive canonical manifest round-trip including nested permission keys", () => {
  const config = {
    model: "gpt-5.6-sol",
    "permissions.weave_probe.filesystem": {
      "/Library/Java/runtime": "read",
      ":minimal": "read",
      "/Users/project/new-workspace": "write",
    },
    approval_policy: "never",
  };
  const manifest = {
    config,
    prompt: "synthetic launch",
    args: cliArgs(config, "synthetic launch"),
  };
  const restored = JSON.parse(canonicalJson(manifest));
  assert.deepEqual(restored.args, cliArgs(restored.config, restored.prompt));
});

test("launch arguments fence leading-hyphen task content from CLI option parsing", () => {
  const prompt = "---\nfeature_ids: []\n---\nActual Markdown task";
  const args = cliArgs({ model: "gpt-5.6-sol" }, prompt);
  assert.deepEqual(args.slice(-2), ["--", prompt]);
});

test("native projection consumes a recorded real-CLI synthetic episode without executing a model", () => {
  const observed = validateNativeTranscript(raw, result.stdout, expected);
  assert.equal(observed.calls, 8);
  assert.equal(observed.recorded_model_responses, 9);
});

test("native projection rejects wrong inputs, permission expansion and missing tool results", () => {
  assert.throws(
    () => validateNativeTranscript(raw, result.stdout, { ...expected, prompt: "another task" }),
    /task prompt missing/,
  );
  const rows = raw.trim().split("\n").map(JSON.parse);
  const expanded = structuredClone(rows);
  expanded
    .find((row) => row.type === "turn_context")
    .payload.permission_profile.file_system.entries.push({
      path: { type: "path", path: "/Users/slipshod/AIBuild/dsh-eval-lab-runtime" },
      access: "read",
    });
  assert.throws(
    () =>
      validateNativeTranscript(expanded.map(JSON.stringify).join("\n"), result.stdout, expected),
    /permission expansion/,
  );
  const missing = rows.filter(
    (row) =>
      !(
        row.type === "response_item" &&
        row.payload.type === "custom_tool_call_output" &&
        row.payload.call_id === "call_preflight_1"
      ),
  );
  assert.throws(
    () => validateNativeTranscript(missing.map(JSON.stringify).join("\n"), result.stdout, expected),
    /tool result binding/,
  );
});
