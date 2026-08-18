import { canonicalJson, sha256Hex } from "../../src/contracts/canonical-json.js";

export const SYNTHETIC_PUBLIC_TASK = "Implement the frozen public reservation task.\n";

const commonTools = [
  { name: "read", description: "read", parameters: { type: "object" } },
  {
    name: "workspace_test",
    description: "test",
    parameters: { type: "object", additionalProperties: false },
  },
] as const;

const goalTools = [
  { name: "get_goal", description: "goal", parameters: { type: "object" } },
  { name: "create_goal", description: "goal", parameters: { type: "object" } },
  { name: "update_goal", description: "goal", parameters: { type: "object" } },
] as const;

export const SYNTHETIC_COMMON_TOOL_DIGEST = sha256Hex(
  canonicalJson([...commonTools].sort((left, right) => left.name.localeCompare(right.name))),
);

export function syntheticSessionLog(input: {
  readonly arm: "control" | "treatment";
  readonly goalActivated?: boolean;
  readonly includeUsage?: boolean;
  readonly completion?: "complete" | "blocked" | "absent";
  readonly publicTask?: string;
  readonly sessionId?: string;
}): string {
  const goalActivated = input.goalActivated ?? input.arm === "treatment";
  const includeUsage = input.includeUsage ?? true;
  const completion = input.completion ?? "complete";
  const publicTask = input.publicTask ?? SYNTHETIC_PUBLIC_TASK;
  const sessionId = input.sessionId ?? `session-${input.arm}`;
  const tools = input.arm === "treatment" ? [...commonTools, ...goalTools] : [...commonTools];
  const rows: Array<{ readonly type: string; readonly data: unknown }> = [
    {
      type: "request/header",
      data: {
        header: {
          config: {
            provider: "openai-codex",
            model: "gpt-5.6-sol",
            reasoningEffort: "xhigh",
          },
          tools,
        },
        reason: "initial",
      },
    },
    {
      type: "request/context",
      data: { provider: "openai-codex", model: "gpt-5.6-sol", contextWindow: 200_000 },
    },
    {
      type: "user/message",
      data: {
        id: `user-${input.arm}`,
        role: "user",
        content: [{ type: "text", text: publicTask }],
        source: { kind: "user" },
      },
    },
    { type: "turn/start", data: { turn: 1 } },
    { type: "step/start", data: { turn: 1, step: 1 } },
  ];
  if (goalActivated) {
    rows.push(
      {
        type: "goal/change",
        data: {
          kind: "goal/change",
          version: 1,
          operation: "create",
          goal: {
            id: `goal-${input.arm}`,
            revision: 1,
            objective: "finish",
            phase: "active",
            maxGoalRounds: 8,
          },
          roundsStarted: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        type: "user/message",
        data: {
          id: `goal-round-1-${input.arm}`,
          role: "user",
          content: [{ type: "text", text: "Continue the frozen public reservation task." }],
          source: {
            kind: "goal",
            goalId: `goal-${input.arm}`,
            revision: 1,
            round: 1,
          },
        },
      },
      {
        type: "user/message",
        data: {
          id: `goal-round-2-${input.arm}`,
          role: "user",
          content: [{ type: "text", text: "Continue the frozen public reservation task." }],
          source: {
            kind: "goal",
            goalId: `goal-${input.arm}`,
            revision: 1,
            round: 2,
          },
        },
      },
      {
        type: "goal/change",
        data: {
          kind: "goal/change",
          version: 1,
          operation: "complete",
          goal: {
            id: `goal-${input.arm}`,
            revision: 2,
            objective: "finish",
            phase: "complete",
            maxGoalRounds: 8,
          },
          roundsStarted: 2,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    );
  }
  rows.push(
    {
      type: "tool/call",
      data: {
        turn: 1,
        step: 1,
        callId: `call-${input.arm}`,
        name: "workspace_test",
        arguments: "{}",
      },
    },
    {
      type: "tool/result",
      data: {
        turn: 1,
        step: 1,
        message: {
          id: `tool-${input.arm}`,
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: `call-${input.arm}`,
              content: [{ type: "text", text: "ok" }],
            },
          ],
          source: { kind: "tool", callId: `call-${input.arm}` },
        },
      },
    },
    {
      type: "assistant/message",
      data: {
        turn: 1,
        step: 1,
        message: {
          id: `assistant-${input.arm}`,
          role: "assistant",
          content: [
            {
              type: "text",
              text:
                completion === "complete"
                  ? "done\nTASK_COMPLETE"
                  : completion === "blocked"
                    ? "blocked\nTASK_BLOCKED"
                    : "done without a terminal token",
            },
          ],
          source: { kind: "model", provider: "openai-codex", model: "gpt-5.6-sol" },
        },
        ...(includeUsage
          ? {
              usage: {
                inputTokens: input.arm === "control" ? 100 : 110,
                cacheReadTokens: 7,
                cacheWriteTokens: 3,
                outputTokens: input.arm === "control" ? 20 : 25,
              },
            }
          : {}),
      },
    },
    { type: "step/end", data: { turn: 1, step: 1 } },
    { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } },
  );
  const header = {
    type: "session",
    version: 0,
    id: sessionId,
    cwd: `/synthetic/${input.arm}`,
    createdAt: Date.parse("2026-08-17T10:00:00.000Z"),
  };
  return [
    JSON.stringify(header),
    ...rows.map((row, index) => JSON.stringify({ ...row, seq: index, time: index + 1 })),
  ].join("\n");
}
