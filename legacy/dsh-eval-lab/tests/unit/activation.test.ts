import assert from "node:assert/strict";
import test from "node:test";

import { decodeOfficialSessionJsonl } from "../../src/projector/jsonl.js";
import { projectGoalActivation } from "../../src/projector/projector.js";
import { syntheticSessionLog } from "../helpers/session.js";

test("typed activation is derived from the same rc.6 Goal fold", () => {
  const control = decodeOfficialSessionJsonl(
    syntheticSessionLog({ arm: "control", goalActivated: false }),
  );
  const treatment = decodeOfficialSessionJsonl(
    syntheticSessionLog({ arm: "treatment", goalActivated: true }),
  );

  assert.deepEqual(projectGoalActivation(control), {
    schema_version: 1,
    harness_id: "dsh-goal-stack",
    session_id: "session-control",
    events: [],
    summary: {
      activated: false,
      event_count: 0,
      continuation_rounds: 0,
      terminal_phase: "none",
    },
  });

  const activation = projectGoalActivation(treatment);
  assert.deepEqual(
    activation.events.map(({ operation, activation_type, revision, phase }) => ({
      operation,
      activation_type,
      revision,
      phase,
    })),
    [
      { operation: "create", activation_type: "activated", revision: 1, phase: "active" },
      { operation: "complete", activation_type: "terminal", revision: 2, phase: "complete" },
    ],
  );
  assert.deepEqual(activation.summary, {
    activated: true,
    event_count: 2,
    continuation_rounds: 2,
    terminal_phase: "complete",
  });
  assert.equal(activation.events[0]?.sequence, 0);
  assert.equal(activation.events[1]?.sequence, 1);
  assert.equal(activation.events[0]?.timestamp, "1970-01-01T00:00:00.006Z");
  assert.equal(activation.events[1]?.timestamp, "1970-01-01T00:00:00.009Z");
});

test("typed activation fails closed on an invalid Goal history", () => {
  const decoded = decodeOfficialSessionJsonl(
    syntheticSessionLog({ arm: "treatment", goalActivated: true }),
  );
  const events = decoded.events.map((event) =>
    event.type === "goal/change" &&
    typeof event.data === "object" &&
    event.data !== null &&
    "operation" in event.data &&
    event.data.operation === "complete"
      ? { ...event, data: { ...event.data, operation: "future-operation" } }
      : event,
  );

  assert.throws(
    () => projectGoalActivation({ header: decoded.header, events }),
    /Goal evidence is invalid/,
  );
});

test("typed activation preserves legal replacement Goal lifecycles", () => {
  const decoded = decodeOfficialSessionJsonl(
    syntheticSessionLog({ arm: "treatment", goalActivated: true }),
  );
  const lastSequence = decoded.events.at(-1)?.seq ?? 0;
  const replacement = {
    type: "goal/change",
    seq: lastSequence + 1,
    time: 20,
    data: {
      kind: "goal/change",
      version: 1,
      operation: "create",
      goal: {
        id: "goal-replacement",
        revision: 1,
        objective: "verify replacement",
        phase: "active",
        maxGoalRounds: 4,
      },
      roundsStarted: 0,
      createdAt: 3,
      updatedAt: 3,
    },
  } as const;

  const activation = projectGoalActivation({
    header: decoded.header,
    events: [...decoded.events, replacement],
  });
  assert.deepEqual(
    activation.events.map((event) => event.goal_id),
    ["goal-treatment", "goal-treatment", "goal-replacement"],
  );
  assert.deepEqual(activation.summary, {
    activated: true,
    event_count: 3,
    continuation_rounds: 2,
    terminal_phase: "active",
  });
});

test("typed activation permits clear followed by a new Goal", () => {
  const decoded = decodeOfficialSessionJsonl(
    syntheticSessionLog({ arm: "control", goalActivated: false }),
  );
  const events = [
    ...decoded.events,
    {
      type: "goal/change",
      seq: 100,
      time: 20,
      data: {
        kind: "goal/change",
        version: 1,
        operation: "create",
        goal: {
          id: "goal-first",
          revision: 1,
          objective: "first",
          phase: "active",
          maxGoalRounds: 4,
        },
        roundsStarted: 0,
        createdAt: 3,
        updatedAt: 3,
      },
    },
    {
      type: "goal/change",
      seq: 101,
      time: 21,
      data: {
        kind: "goal/change",
        version: 1,
        operation: "clear",
        cleared: { id: "goal-first", revision: 2 },
        clearedAt: 4,
      },
    },
    {
      type: "goal/change",
      seq: 102,
      time: 22,
      data: {
        kind: "goal/change",
        version: 1,
        operation: "create",
        goal: {
          id: "goal-second",
          revision: 1,
          objective: "second",
          phase: "active",
          maxGoalRounds: 4,
        },
        roundsStarted: 0,
        createdAt: 5,
        updatedAt: 5,
      },
    },
  ];

  const activation = projectGoalActivation({ header: decoded.header, events });
  assert.deepEqual(
    activation.events.map(({ operation, goal_id }) => ({ operation, goal_id })),
    [
      { operation: "create", goal_id: "goal-first" },
      { operation: "clear", goal_id: "goal-first" },
      { operation: "create", goal_id: "goal-second" },
    ],
  );
  assert.equal(activation.summary.terminal_phase, "active");
});
