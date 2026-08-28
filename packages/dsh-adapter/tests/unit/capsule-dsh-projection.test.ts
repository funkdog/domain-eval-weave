import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCommerceCapsuleObservation, projectRawDshTddEvents } from "../../src/index.js";

test("raw DSH tool evidence projects only typed Skill, write and test events", () => {
  const rows = [
    { type: "session", id: "session-1", createdAt: 1 },
    {
      type: "tool/call",
      seq: 1,
      data: { callId: "skill-1", name: "skill", arguments: JSON.stringify({ name: "tdd" }) },
    },
    {
      type: "tool/call",
      seq: 2,
      data: {
        callId: "write-1",
        name: "write",
        arguments: JSON.stringify({ file_path: "test/agent/cancel.test.ts", content: "hidden" }),
      },
    },
    {
      type: "tool/call",
      seq: 3,
      data: { callId: "test-1", name: "workspace_test", arguments: "{}" },
    },
    {
      type: "tool/result",
      seq: 4,
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "test-1",
              content: [{ type: "text", text: JSON.stringify({ exitCode: 1 }) }],
            },
          ],
        },
      },
    },
    {
      type: "tool/call",
      seq: 5,
      data: {
        callId: "edit-1",
        name: "edit",
        arguments: JSON.stringify({ file_path: "src/order-service.ts" }),
      },
    },
  ];
  assert.deepEqual(projectRawDshTddEvents(rows.map((row) => JSON.stringify(row)).join("\n")), [
    { seq: 1, type: "skill_loaded", skill_id: "mattpocock-tdd" },
    { seq: 2, type: "file_write", path: "test/agent/cancel.test.ts" },
    { seq: 4, type: "test_run", scope: "full", exit_code: 1 },
    { seq: 5, type: "file_write", path: "src/order-service.ts" },
  ]);
});

test("Commerce adapter does not mistake unavailable replay for idempotency", () => {
  const normalForm = {
    schema_version: 1,
    operation: { status: "accepted" },
    state: [
      {
        field_id: "order_status",
        value: { domain_id: "order_status_enum", scalar: "cancelled" },
      },
    ],
    effects: [{ effect_id: "refund_requested", identity: [], attributes: [] }],
    relations: [],
  };
  const observation = normalizeCommerceCapsuleObservation({
    paidUnstarted: {
      operations: { cancel_order: "accepted" },
      normal_forms: { after: normalForm },
    },
    requestReplay: {
      operations: { cancel_order: "unavailable" },
      normal_forms: {
        replay: {
          ...normalForm,
          operation: { status: "unavailable" },
          state: [],
          effects: [],
          relations: [{ relation_id: "request_replay_same_as_first", status: false }],
        },
      },
    },
  });
  assert.deepEqual(observation, {
    state: { status: "cancelled" },
    effects: [{ type: "refund_requested" }],
    repeat: { status: "unavailable", effects: [] },
  });
});
