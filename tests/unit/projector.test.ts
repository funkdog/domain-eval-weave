import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeOfficialSessionJsonl,
  decodeSessionJsonl,
  type SessionEventRecord,
} from "../../src/projector/jsonl.js";
import { projectSessionEvidence } from "../../src/projector/projector.js";
import { evaluationFromEvidence } from "../../src/validity/evaluation.js";

const header = {
  type: "session",
  version: 0,
  id: "session-one",
  cwd: "/synthetic/workspace",
  createdAt: Date.parse("2026-08-17T10:00:00.000Z"),
} as const;

const events = [
  {
    type: "request/header",
    seq: 0,
    time: 1,
    data: {
      header: {
        config: {
          provider: "openai-codex",
          model: "gpt-5.6-sol",
          reasoningEffort: "xhigh",
        },
        tools: [
          { name: "read", description: "read", parameters: { type: "object" } },
          {
            name: "workspace_test",
            description: "test",
            parameters: { type: "object", additionalProperties: false },
          },
        ],
      },
      reason: "initial",
    },
  },
  {
    type: "request/context",
    seq: 1,
    time: 2,
    data: { provider: "openai-codex", model: "gpt-5.6-sol", contextWindow: 200_000 },
  },
  {
    type: "user/message",
    seq: 2,
    time: 3,
    data: {
      id: "user-1",
      role: "user",
      content: [{ type: "text", text: "public task" }],
      source: { kind: "user" },
    },
  },
  { type: "turn/start", seq: 3, time: 4, data: { turn: 1 } },
  { type: "step/start", seq: 4, time: 5, data: { turn: 1, step: 1 } },
  {
    type: "goal/change",
    seq: 5,
    time: 6,
    data: {
      kind: "goal/change",
      version: 1,
      operation: "create",
      goal: {
        id: "goal-1",
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
    seq: 6,
    time: 7,
    data: {
      id: "goal-round-1",
      role: "user",
      content: [{ type: "text", text: "Continue the public task." }],
      source: { kind: "goal", goalId: "goal-1", revision: 1, round: 1 },
    },
  },
  {
    type: "user/message",
    seq: 7,
    time: 8,
    data: {
      id: "goal-round-2",
      role: "user",
      content: [{ type: "text", text: "Continue the public task." }],
      source: { kind: "goal", goalId: "goal-1", revision: 1, round: 2 },
    },
  },
  {
    type: "goal/change",
    seq: 8,
    time: 9,
    data: {
      kind: "goal/change",
      version: 1,
      operation: "complete",
      goal: {
        id: "goal-1",
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
  {
    type: "tool/call",
    seq: 9,
    time: 10,
    data: { turn: 1, step: 1, callId: "call-1", name: "workspace_test", arguments: "{}" },
  },
  {
    type: "tool/result",
    seq: 10,
    time: 11,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: "tool-1",
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            content: [{ type: "text", text: "ok" }],
          },
        ],
        source: { kind: "tool", callId: "call-1" },
      },
    },
  },
  {
    type: "assistant/message",
    seq: 11,
    time: 12,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: "assistant-1",
        role: "assistant",
        content: [
          { type: "reasoning", text: "private reasoning" },
          { type: "text", text: "done\nTASK_COMPLETE" },
        ],
        source: { kind: "model", provider: "openai-codex", model: "gpt-5.6-sol" },
      },
      usage: { inputTokens: 100, cacheReadTokens: 7, cacheWriteTokens: 3, outputTokens: 20 },
    },
  },
  { type: "step/end", seq: 12, time: 13, data: { turn: 1, step: 1 } },
  { type: "turn/end", seq: 13, time: 14, data: { turn: 1, reason: { kind: "completed" } } },
] as const;

const project = (candidateEvents: readonly SessionEventRecord[] = events) =>
  projectSessionEvidence({
    header,
    events: candidateEvents,
    expectedPublicTask: "public task",
  });

type UnsequencedEvent = Omit<SessionEventRecord, "seq" | "time">;

const goalSnapshot = (
  operation: "create" | "edit" | "pause" | "resume" | "complete" | "block",
  revision: number,
  phase: "active" | "paused" | "blocked" | "complete",
  overrides: {
    readonly objective?: string;
    readonly maxGoalRounds?: number;
    readonly roundsStarted?: number;
    readonly createdAt?: number;
    readonly updatedAt?: number;
  } = {},
): UnsequencedEvent => ({
  type: "goal/change",
  data: {
    kind: "goal/change",
    version: 1,
    operation,
    goal: {
      id: "goal-1",
      revision,
      objective: overrides.objective ?? "finish",
      phase,
      maxGoalRounds: overrides.maxGoalRounds ?? 8,
      ...(phase === "blocked"
        ? { blockedReason: { code: "needs-input", message: "Needs input" } }
        : {}),
    },
    roundsStarted: overrides.roundsStarted ?? 0,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? revision,
  },
});

const withGoalEvidence = (rows: readonly UnsequencedEvent[]): SessionEventRecord[] => {
  const result: UnsequencedEvent[] = [];
  for (const event of events) {
    if (event.type === "goal/change") continue;
    if (event.type === "user/message" && event.data.source.kind === "goal") continue;
    if (event.type === "tool/call") result.push(...rows);
    result.push({ type: event.type, data: event.data });
  }
  return result.map((event, index) => ({ ...event, seq: index, time: index + 1 }));
};

test("official-decoder seam rejects packed rows and seq gaps", () => {
  const text = [JSON.stringify(header), ...events.map((event) => JSON.stringify(event))].join("\n");
  const decoded = decodeSessionJsonl(text, (record) => [record]);
  assert.equal(decoded.events.length, events.length);
  assert.deepEqual(decodeOfficialSessionJsonl(text), decoded);
  assert.throws(() =>
    decodeSessionJsonl(
      `${JSON.stringify(header)}\n${JSON.stringify({ type: "text-chunks", seq0: 0 })}`,
      (record) => [record],
    ),
  );
  assert.throws(() =>
    decodeSessionJsonl(
      `${JSON.stringify(header)}\n${JSON.stringify({ ...events[0], seq: 1 })}`,
      (record) => [record],
    ),
  );
});

test("projector folds real rc.6 Goal, messages, tools, lifecycle, and usage", () => {
  const projection = project(events);
  assert.equal(projection.measurement_validity.overall, "valid");
  assert.equal(projection.completion_claim, "complete");
  assert.deepEqual(projection.mechanism, {
    goal_created: true,
    goal_rounds_started: 2,
    goal_terminal_phase: "complete",
    tool_calls: { workspace_test: 1 },
    turns: 1,
    steps: 1,
  });
  assert.deepEqual(projection.cost, {
    input_tokens: 100,
    cached_input_tokens: 10,
    output_tokens: 20,
    failed_tool_calls: 0,
  });
  assert.deepEqual(project(events), projection);
});

test("projector invalidates a Session whose user task differs from the frozen public prompt", () => {
  const poisoned = events.map((event) =>
    event.type === "user/message" && event.data.source.kind === "user"
      ? {
          ...event,
          data: {
            ...event.data,
            content: [{ type: "text", text: "public task\narm=treatment" }],
          },
        }
      : event,
  );
  const projection = project(poisoned);
  assert.equal(projection.measurement_validity.overall, "invalid");
  assert.equal(projection.prompt_isolation_valid, false);
});

test("missing usage abstains on token cost without invalidating mechanism", () => {
  const withoutUsage = events.map((event) =>
    event.type === "assistant/message"
      ? {
          ...event,
          data: { turn: event.data.turn, step: event.data.step, message: event.data.message },
        }
      : event,
  );
  const projection = project(withoutUsage);
  assert.equal(projection.measurement_validity.dimensions.cost, "insufficient");
  assert.equal(projection.measurement_validity.dimensions.mechanism, "valid");
  assert.equal(projection.cost.input_tokens, null);
});

test("missing terminal token abstains on claim interpretation while preserving Oracle outcome", () => {
  const withoutClaim = events.map((event) =>
    event.type === "assistant/message"
      ? {
          ...event,
          data: {
            ...event.data,
            message: {
              ...event.data.message,
              content: [{ type: "text", text: "implementation finished" }],
            },
          },
        }
      : event,
  );
  const projection = project(withoutClaim);
  assert.equal(projection.completion_claim, "absent");
  assert.equal(projection.measurement_validity.overall, "insufficient");
  assert.equal(projection.measurement_validity.dimensions.outcome, "valid");
});

test("known rc.6 lifecycle events are tolerated while unknown required events invalidate", () => {
  const terminalEvent = events.at(-1);
  assert.ok(terminalEvent);
  const known = [
    ...events.slice(0, -1),
    { type: "assistant/chunk", seq: 11, time: 12, data: { turn: 1, step: 1, chunk: {} } },
    { ...terminalEvent, seq: 12, time: 13 },
  ];
  assert.equal(project(known).measurement_validity.overall, "valid");

  const unknown = [
    ...events,
    { type: "future/required", seq: 12, time: 13, data: {}, ignorable: false },
  ];
  assert.equal(project(unknown).measurement_validity.overall, "invalid");
});

test("projector rejects unknown Goal operations and malformed clear payloads", () => {
  const futureOperation = events.map((event) =>
    event.type === "goal/change" && event.data.operation === "create"
      ? { ...event, data: { ...event.data, operation: "future-operation" } }
      : event,
  );
  const futureProjection = project(futureOperation);
  assert.equal(futureProjection.measurement_validity.overall, "invalid");
  assert.equal(futureProjection.measurement_validity.dimensions.mechanism, "invalid");
  assert.equal(futureProjection.mechanism.goal_terminal_phase, "none");

  const malformedClear = events.map((event) =>
    event.type === "goal/change" && event.data.operation === "complete"
      ? { ...event, data: { ...event.data, operation: "clear" } }
      : event,
  );
  assert.equal(project(malformedClear).measurement_validity.dimensions.mechanism, "invalid");
});

test("projector accepts the exact rc.6 clear tombstone shape", () => {
  const cleared = events.map((event) =>
    event.type === "goal/change" && event.data.operation === "complete"
      ? {
          ...event,
          data: {
            kind: "goal/change",
            version: 1,
            operation: "clear",
            cleared: { id: "goal-1", revision: 2 },
            clearedAt: 2,
          },
        }
      : event,
  );
  const projection = project(cleared);
  assert.equal(projection.measurement_validity.dimensions.mechanism, "valid");
  assert.equal(projection.mechanism.goal_created, true);
  assert.equal(projection.mechanism.goal_terminal_phase, "none");
});

test("projector rejects Goal continuation rounds that skip the next admitted round", () => {
  const skippedRound = withGoalEvidence([
    goalSnapshot("create", 1, "active"),
    {
      type: "user/message",
      data: {
        id: "goal-round-2",
        role: "user",
        content: [{ type: "text", text: "Continue the public task." }],
        source: { kind: "goal", goalId: "goal-1", revision: 1, round: 2 },
      },
    },
    goalSnapshot("complete", 2, "complete", { roundsStarted: 2 }),
  ]);
  assert.equal(project(skippedRound).measurement_validity.dimensions.mechanism, "invalid");
});

test("projector rejects rc.6 operations that mutate protected state", () => {
  const invalidOperations = [
    goalSnapshot("edit", 2, "paused"),
    goalSnapshot("pause", 2, "paused", { objective: "tampered" }),
    goalSnapshot("resume", 2, "active", { objective: "tampered" }),
    goalSnapshot("complete", 2, "complete", { objective: "tampered" }),
    goalSnapshot("block", 2, "blocked", { objective: "tampered" }),
  ] as const;

  for (const invalidOperation of invalidOperations) {
    const projection = project(
      withGoalEvidence([goalSnapshot("create", 1, "active"), invalidOperation]),
    );
    assert.equal(
      projection.measurement_validity.dimensions.mechanism,
      "invalid",
      String((invalidOperation.data as Record<string, unknown>).operation),
    );
  }
});

test("projector rejects forbidden rc.6 source-phase transitions", () => {
  const invalidSequences = [
    [
      goalSnapshot("create", 1, "active"),
      goalSnapshot("pause", 2, "paused"),
      goalSnapshot("pause", 3, "paused"),
    ],
    [
      goalSnapshot("create", 1, "active"),
      goalSnapshot("complete", 2, "complete"),
      goalSnapshot("resume", 3, "active"),
    ],
    [
      goalSnapshot("create", 1, "active"),
      goalSnapshot("pause", 2, "paused"),
      goalSnapshot("block", 3, "blocked"),
    ],
    [
      goalSnapshot("create", 1, "active"),
      goalSnapshot("complete", 2, "complete"),
      goalSnapshot("complete", 3, "complete"),
    ],
  ] as const;

  for (const sequence of invalidSequences) {
    assert.equal(
      project(withGoalEvidence(sequence)).measurement_validity.dimensions.mechanism,
      "invalid",
    );
  }
});

test("projector accepts the official rc.6 edit and phase-transition sequence", () => {
  const changedDefinition = { objective: "finish safely", maxGoalRounds: 6 } as const;
  const projection = project(
    withGoalEvidence([
      goalSnapshot("create", 1, "active"),
      goalSnapshot("edit", 2, "active", changedDefinition),
      goalSnapshot("pause", 3, "paused", changedDefinition),
      goalSnapshot("resume", 4, "active", changedDefinition),
      goalSnapshot("block", 5, "blocked", changedDefinition),
      goalSnapshot("resume", 6, "active", changedDefinition),
      goalSnapshot("complete", 7, "complete", changedDefinition),
    ]),
  );

  assert.equal(projection.measurement_validity.dimensions.mechanism, "valid");
  assert.equal(projection.mechanism.goal_terminal_phase, "complete");
});

test("projector rejects resume after the Goal round budget is exhausted", () => {
  const oneRound = { maxGoalRounds: 1 } as const;
  const projection = project(
    withGoalEvidence([
      goalSnapshot("create", 1, "active", oneRound),
      {
        type: "user/message",
        data: {
          id: "goal-round-1",
          role: "user",
          content: [{ type: "text", text: "Continue the public task." }],
          source: { kind: "goal", goalId: "goal-1", revision: 1, round: 1 },
        },
      },
      goalSnapshot("pause", 2, "paused", { ...oneRound, roundsStarted: 1 }),
      goalSnapshot("resume", 3, "active", { ...oneRound, roundsStarted: 1 }),
    ]),
  );

  assert.equal(projection.measurement_validity.dimensions.mechanism, "invalid");
});

test("open lifecycle boundaries and model-facing tool errors invalidate or count correctly", () => {
  const openStep = events.filter((event) => event.type !== "step/end");
  assert.equal(project(openStep).measurement_validity.overall, "invalid");

  const failed = events.map((event) =>
    event.type === "tool/result"
      ? {
          ...event,
          data: {
            ...event.data,
            message: {
              ...event.data.message,
              content: [{ ...event.data.message.content[0], isError: true }],
            },
          },
        }
      : event,
  );
  assert.equal(project(failed).cost.failed_tool_calls, 1);
});

test("external completion and false-completion stay separate from the Agent claim", () => {
  const projection = project(events);
  const behavior = {
    basic_reservation: "pass",
    idempotent_replay: "pass",
    conflicting_replay_rejected: "pass",
    no_oversubscription_concurrent: "fail",
    terminal_transition_idempotency: "pass",
    restart_recovery: "pass",
    corrupt_state_fail_closed: "pass",
    deterministic_snapshot: "pass",
  } as const;
  const evaluation = evaluationFromEvidence({
    projection,
    behavior,
    candidateAuthorized: true,
    oracleHidden: true,
    candidateFrozenBeforeOracle: true,
    candidateUnchangedAfterOracle: true,
    deploymentFingerprintMatches: true,
    goalExpected: false,
    carrierProcessHealthy: true,
    elapsedMs: 1_000,
  });
  assert.equal(evaluation.outcome.externally_verified_completion, false);
  assert.equal(evaluation.outcome.completion_claim, "complete");
  assert.equal(evaluation.outcome.false_completion_claim, true);
});

test("a treatment that never creates Goal is mechanism-insufficient, not an outcome failure", () => {
  const projection = project(withGoalEvidence([]));
  const behavior = {
    basic_reservation: "pass",
    idempotent_replay: "pass",
    conflicting_replay_rejected: "pass",
    no_oversubscription_concurrent: "pass",
    terminal_transition_idempotency: "pass",
    restart_recovery: "pass",
    corrupt_state_fail_closed: "pass",
    deterministic_snapshot: "pass",
  } as const;
  const evaluation = evaluationFromEvidence({
    projection,
    behavior,
    candidateAuthorized: true,
    oracleHidden: true,
    candidateFrozenBeforeOracle: true,
    candidateUnchangedAfterOracle: true,
    deploymentFingerprintMatches: true,
    goalExpected: true,
    carrierProcessHealthy: true,
    elapsedMs: 1_000,
  });
  assert.equal(evaluation.measurement_validity.dimensions.outcome, "valid");
  assert.equal(evaluation.measurement_validity.dimensions.mechanism, "insufficient");
  assert.equal(evaluation.measurement_validity.overall, "insufficient");
  assert.equal(evaluation.outcome.externally_verified_completion, true);
});
