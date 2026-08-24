import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

import { PHASE3C_JUDGE } from "../../src/instance.js";

test("Phase 3C Judge patch disables every mutable or measurement-leaking capability", async () => {
  const rows = parse(
    await readFile(new URL("../../variants/judge.patch.yml", import.meta.url), "utf8"),
  ) as Array<{ readonly id: string; readonly disabled?: boolean; readonly config?: unknown }>;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const disabled = [
    "dsh-eval-app",
    "dsh-eval-bridge",
    "dsh-eval-author-bridge",
    "dsh-eval-domain-skill",
    "tool-bash",
    "tool-pwsh",
    "tool-jobs",
    "tool-str-replace-editor",
    "tool-web",
    "tool-skill",
    "tool-subagent-control",
    "tool-subagent-list-agents",
    "tool-subagent",
    "tool-subagent-fork",
    "tool-subagent-report",
    "tool-workflow",
    "tool-ralph",
    "plan-mode",
    "goal",
    "goal-round-driver",
    "command-goal",
    "tool-goal",
  ];
  for (const id of disabled) assert.equal(byId.get(id)?.disabled, true, id);
  assert.deepEqual(byId.get("session-persistence-jsonl")?.config, {
    root: PHASE3C_JUDGE.sessionsRoot,
    compression: "none",
    packChunks: false,
  });
  assert.deepEqual(byId.get("approval")?.config, { policy: "never" });
});

test("Phase 3C TDD arms differ only by normal DSH Skill availability", async () => {
  const [off, on] = await Promise.all([
    readFile(new URL("../../variants/tdd-off.patch.yml", import.meta.url), "utf8").then(parse),
    readFile(new URL("../../variants/tdd-on.patch.yml", import.meta.url), "utf8").then(parse),
  ]);
  assert.deepEqual(off.slice(0, -1), on.slice(0, -1));
  assert.deepEqual(off.at(-1), { id: "tool-skill", disabled: true });
  assert.deepEqual(on.at(-1), { id: "tool-skill", disabled: false });
});
