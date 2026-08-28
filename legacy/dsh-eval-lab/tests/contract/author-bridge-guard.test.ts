import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

import applyDshEvalAuthorBridge, { createAuthorToolGuard } from "../../src/author-bridge/index.js";
import type { GuardedToolExecution } from "../../src/bridge/guard.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const authorProfileBaseUrl = pathToFileURL(
  `${DEDICATED_DSH_HOME}/profiles/eval-clowder-author/`,
).href;

test("author guard confines all editor reads and domain-eval writes to the selected workspace", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/author-guard-`);
  const workspace = `${scratch}/workspace`;
  const outside = `${scratch}/outside`;
  await mkdir(`${workspace}/domain-eval`, { recursive: true, mode: 0o700 });
  await mkdir(outside, { mode: 0o700 });
  await writeFile(`${workspace}/README.md`, "authorized source\n", { mode: 0o600 });
  await writeFile(`${outside}/secret.txt`, "forbidden\n", { mode: 0o600 });
  await symlink(outside, `${workspace}/escape`);
  try {
    const guard = createAuthorToolGuard({ workspaceRoot: workspace });
    const editor = (command: string, path: string) =>
      guard({
        name: "str_replace_editor",
        arguments: { command, path },
      } satisfies GuardedToolExecution);

    assert.equal(editor("view", `${workspace}/README.md`), undefined);
    assert.match(
      editor("create", `${workspace}/domain-eval/candidates/card.json`) ?? "",
      /domain_artifact/,
    );
    assert.match(
      editor("str_replace", `${workspace}/domain-eval/sources/policy.md`) ?? "",
      /domain_artifact/,
    );
    assert.equal(editor("create", `${workspace}/domain-eval/decision-packet.json`), undefined);
    assert.match(editor("create", `${workspace}/notes.json`) ?? "", /domain-eval/);
    assert.match(editor("view", `${outside}/secret.txt`) ?? "", /outside/);
    assert.match(editor("view", `${workspace}/escape/secret.txt`) ?? "", /outside/);
    assert.equal(guard({ name: "skill", arguments: {} }), undefined);
    assert.match(guard({ name: "read", arguments: { path: "/etc/passwd" } }) ?? "", /not allowed/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("author bridge installs the guard only in the exact author profile", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(`${parent}/author-bridge-`);
  let installed: ((execution: GuardedToolExecution) => string | undefined) | undefined;
  let registered: { readonly name?: string } | undefined;
  try {
    await applyDshEvalAuthorBridge(
      {
        root: { baseUrl: authorProfileBaseUrl },
        tools: {
          guard: (value) => (installed = value),
          register: (value) => (registered = value),
        },
      },
      {
        workspaceRoot: workspace,
        env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
        assertLayout: async () => undefined,
      },
    );
    assert.ok(installed);
    assert.equal(registered?.name, "domain_artifact");

    let wrongProfileInstalled = false;
    let wrongProfileRegistered = false;
    await assert.rejects(
      applyDshEvalAuthorBridge(
        {
          root: {
            baseUrl: pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-clowder-runner/`).href,
          },
          tools: {
            guard: () => (wrongProfileInstalled = true),
            register: () => (wrongProfileRegistered = true),
          },
        },
        {
          workspaceRoot: workspace,
          env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
          assertLayout: async () => undefined,
        },
      ),
      /eval-clowder-author/,
    );
    assert.equal(wrongProfileInstalled, false);
    assert.equal(wrongProfileRegistered, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
