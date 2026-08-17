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
