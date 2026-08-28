import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createWorkspaceToolGuard, type GuardedToolExecution } from "../../src/bridge/guard.js";
import applyDshEvalBridge from "../../src/bridge/index.js";
import { createWorkspaceTestDefinition } from "../../src/bridge/workspace-test.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const runnerProfileBaseUrl = pathToFileURL(
  `${DEDICATED_DSH_HOME}/profiles/eval-clowder-runner/`,
).href;

test("bridge guard allows workspace reads and src writes but rejects escapes before bodies run", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/bridge-m1-`);
  const workspace = `${root}/workspace`;
  const outside = `${root}/outside`;
  await mkdir(`${workspace}/src`, { recursive: true, mode: 0o700 });
  await mkdir(outside, { mode: 0o700 });
  await writeFile(`${workspace}/README.md`, "public", "utf8");
  await writeFile(`${outside}/secret.txt`, "sentinel", "utf8");
  await symlink(outside, `${workspace}/escape`);

  try {
    const guard = createWorkspaceToolGuard({ workspaceRoot: workspace });
    const reason = (name: string, path?: string) =>
      guard({
        name,
        arguments:
          path === undefined
            ? {}
            : name === "glob" || name === "grep"
              ? { path }
              : { file_path: path },
      } as GuardedToolExecution);

    assert.equal(reason("read", "README.md"), undefined);
    assert.equal(reason("write", "src/ledger.ts"), undefined);
    assert.match(reason("write", "README.md") ?? "", /src/);
    assert.match(
      reason("read", `${DEDICATED_RUNTIME_ROOT}/dsh-home/.openai-codex-auth.json`) ?? "",
      /workspace/,
    );
    assert.match(reason("read", "escape/secret.txt") ?? "", /workspace/);
    assert.equal(reason("get_goal"), undefined);
    assert.equal(
      guard({ name: "create_goal", arguments: { objective: "finish", max_goal_rounds: 8 } }),
      undefined,
    );
    assert.match(
      guard({ name: "create_goal", arguments: { objective: "finish", max_goal_rounds: 9 } }) ?? "",
      /at most 8/,
    );
    assert.equal(
      guard({
        name: "update_goal",
        arguments: { goal_id: "goal", revision: 1, action: "complete" },
      }),
      undefined,
    );
    assert.match(reason("tool-bash") ?? "", /not allowed/);

    const tddGuard = createWorkspaceToolGuard({
      workspaceRoot: workspace,
      allowedWriteRoots: ["src", "test/agent"],
      allowedSkillNames: ["tdd"],
    });
    assert.equal(tddGuard({ name: "skill", arguments: { name: "tdd" } }), undefined);
    assert.match(
      tddGuard({ name: "skill", arguments: { name: "another-skill" } }) ?? "",
      /not allowlisted/,
    );
    assert.equal(
      tddGuard({ name: "write", arguments: { file_path: "test/agent/cancel.test.ts" } }),
      undefined,
    );
    assert.match(
      tddGuard({ name: "write", arguments: { file_path: "test/public/cancel.test.ts" } }) ?? "",
      /src, test\/agent/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace_test has a closed schema and fixed argv", async () => {
  const calls: unknown[] = [];
  const definition = createWorkspaceTestDefinition({
    workspaceRoot: "/tmp/synthetic-workspace",
    runner: {
      run: async (input) => {
        calls.push(input);
        return { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false };
      },
    },
  });

  assert.deepEqual(definition.parameters, {
    type: "object",
    additionalProperties: false,
    properties: {},
  });
  await definition.execute({});
  await assert.rejects(definition.execute({ command: "cat /etc/passwd" } as never));
  assert.deepEqual(calls, [
    {
      argv: ["node", "--test", "test/public/*.test.ts"],
      cwd: "/tmp/synthetic-workspace",
      purpose: "public-test",
    },
  ]);
});

test("default bridge runner executes public tests inside workspace/tmp", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(`${scratchParent}/bridge-public-test-`);
  const packRoot = new URL("../../task-packs/open-coding-ts-ledger-v1/", import.meta.url);
  await cp(new URL("base/", packRoot), workspace, { recursive: true });
  await cp(
    new URL("calibration/gold-equivalent/src/ledger.ts", packRoot),
    `${workspace}/src/ledger.ts`,
    { force: true },
  );
  let definition: ReturnType<typeof createWorkspaceTestDefinition> | undefined;
  try {
    await applyDshEvalBridge(
      {
        root: { baseUrl: runnerProfileBaseUrl },
        tools: {
          guard: () => undefined,
          register: (value) => {
            definition = value;
          },
        },
      },
      {
        workspaceRoot: workspace,
        env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
      },
    );
    assert.ok(definition);
    const result = (await definition.execute({})) as { exitCode: number | null; stderr: string };
    assert.equal(result.exitCode, 0, result.stderr);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("bridge rejects the wrong current DSH profile before installing guards or tools", async () => {
  let guarded = false;
  let registered = false;
  await assert.rejects(
    applyDshEvalBridge(
      {
        root: {
          baseUrl: pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-dsh-runner/`).href,
        },
        tools: {
          guard: () => {
            guarded = true;
          },
          register: () => {
            registered = true;
          },
        },
      },
      {
        workspaceRoot: "/tmp/never-used",
        env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
      },
    ),
    /profile/i,
  );
  assert.equal(guarded, false);
  assert.equal(registered, false);
});
