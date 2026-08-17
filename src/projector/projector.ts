import { isAbsolute } from "node:path";

import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";

import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";
import type { Diagnostic, MeasurementValidity } from "../contracts/parsers.js";
import type { SessionEventRecord, SessionHeaderRecord } from "./jsonl.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordData(event: SessionEventRecord): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {};
}

function terminalClaim(text: string | undefined): "complete" | "blocked" | "absent" {
  if (text === undefined) return "absent";
  const trimmed = text.trimEnd();
  if (/(?:^|\n)TASK_COMPLETE$/.test(trimmed)) return "complete";
  if (/(?:^|\n)TASK_BLOCKED$/.test(trimmed)) return "blocked";
  return "absent";
}

function assistantText(event: SessionEventRecord): string | undefined {
  const message = recordData(event).message;
  if (!isRecord(message) || !Array.isArray(message.content)) return undefined;
  const text = message.content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text")
    .map((block) => block.text)
    .filter((value): value is string => typeof value === "string")
    .join("");
  return text.trim().length > 0 ? text : undefined;
}

function resultCallId(data: Record<string, unknown>): string | undefined {
  const message = data.message;
  if (!isRecord(message)) return undefined;
  const source = message.source;
  if (isRecord(source) && source.kind === "tool" && typeof source.callId === "string") {
    return source.callId;
  }
  if (!Array.isArray(message.content)) return undefined;
  for (const block of message.content) {
    if (isRecord(block) && block.type === "tool-result" && typeof block.toolCallId === "string") {
      return block.toolCallId;
    }
  }
  return undefined;
}

function modelFacingToolError(data: Record<string, unknown>): boolean {
  const message = data.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return false;
  return message.content.some(
    (block) => isRecord(block) && block.type === "tool-result" && block.isError === true,
  );
}

function usageRecord(event: SessionEventRecord): Record<string, unknown> | undefined {
  const usage = recordData(event).usage;
  return isRecord(usage) ? usage : undefined;
}

function validUsage(usage: Record<string, unknown>): boolean {
  const required = [usage.inputTokens, usage.outputTokens];
  const optional = [usage.cacheReadTokens, usage.cacheWriteTokens, usage.reasoningTokens];
  return (
    required.every((value) => Number.isSafeInteger(value) && (value as number) >= 0) &&
    optional.every(
      (value) => value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0),
    )
  );
}

function validLifecycle(events: readonly SessionEventRecord[]): boolean {
  let openTurn: number | undefined;
  let openStep: number | undefined;
  for (const event of events) {
    const data = recordData(event);
    if (event.type === "turn/start") {
      if (openTurn !== undefined || !Number.isSafeInteger(data.turn)) return false;
      openTurn = data.turn as number;
    } else if (event.type === "step/start") {
      if (
        openTurn === undefined ||
        openStep !== undefined ||
        data.turn !== openTurn ||
        !Number.isSafeInteger(data.step)
      ) {
        return false;
      }
      openStep = data.step as number;
    } else if (event.type === "step/end") {
      if (openTurn === undefined || data.turn !== openTurn || data.step !== openStep) return false;
      openStep = undefined;
    } else if (event.type === "turn/end") {
      if (openTurn === undefined || openStep !== undefined || data.turn !== openTurn) return false;
      openTurn = undefined;
    }
  }
  return openTurn === undefined && openStep === undefined;
}

export interface SessionProjection {
  readonly measurement_validity: MeasurementValidity;
  readonly completion_claim: "complete" | "blocked" | "absent";
  readonly mechanism: {
    readonly goal_created: boolean;
    readonly goal_rounds_started: number;
    readonly goal_terminal_phase: "complete" | "blocked" | "paused" | "active" | "none";
    readonly tool_calls: Readonly<Record<string, number>>;
    readonly turns: number;
    readonly steps: number;
  };
  readonly cost: {
    readonly input_tokens: number | null;
    readonly cached_input_tokens: number | null;
    readonly output_tokens: number | null;
    readonly failed_tool_calls: number;
  };
  readonly deployment: {
    readonly common_tool_schema_sha256: string;
    readonly full_tool_schema_sha256: string;
    readonly tool_names: readonly string[];
  };
}

export function projectSessionEvidence(input: {
  readonly header: SessionHeaderRecord;
  readonly events: readonly SessionEventRecord[];
}): SessionProjection {
  const seedBoundary = input.events.findLastIndex((event) => event.type === "session/end-seed");
  const events = input.events.slice(seedBoundary + 1);
  const presentTypes = new Set(events.map((event) => event.type));
  const reasons: Diagnostic[] = [];
  let invalid = false;

  for (const event of events) {
    if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) invalid = true;
  }
  for (const required of [
    "request/header",
    "request/context",
    "user/message",
    "assistant/message",
    "tool/call",
    "tool/result",
    "turn/end",
  ]) {
    if (!presentTypes.has(required)) invalid = true;
  }

  const headerDepth = input.header.delegationDepth ?? 0;
  if (
    input.header.version !== 0 ||
    input.header.cwd === undefined ||
    !isAbsolute(input.header.cwd) ||
    input.header.parentSession !== undefined ||
    headerDepth !== 0 ||
    input.header.agentPreset !== undefined
  ) {
    invalid = true;
  }

  const requestHeaders = events.filter((event) => event.type === "request/header");
  const requestToolSchemas: unknown[][] = [];
  for (const event of requestHeaders) {
    const data = recordData(event);
    const epochHeader = data.header;
    const config = isRecord(epochHeader) ? epochHeader.config : undefined;
    const tools = isRecord(epochHeader) ? epochHeader.tools : undefined;
    if (
      !isRecord(config) ||
      config.provider !== "openai-codex" ||
      config.model !== "gpt-5.6-sol" ||
      config.reasoningEffort !== "xhigh" ||
      !Array.isArray(tools) ||
      tools.length === 0 ||
      !tools.every((tool) => isRecord(tool) && typeof tool.name === "string") ||
      !tools.some((tool) => isRecord(tool) && tool.name === "workspace_test")
    ) {
      invalid = true;
    } else {
      requestToolSchemas.push(tools);
    }
  }
  const goalToolNames = new Set(["get_goal", "create_goal", "update_goal"]);
  const normalizedTools = (tools: readonly unknown[], includeGoal: boolean): unknown[] =>
    tools
      .filter((tool) => isRecord(tool) && (includeGoal || !goalToolNames.has(String(tool.name))))
      .sort((left, right) =>
        String((left as Record<string, unknown>).name).localeCompare(
          String((right as Record<string, unknown>).name),
        ),
      );
  const commonToolDigests = requestToolSchemas.map((tools) =>
    sha256Hex(canonicalJson(normalizedTools(tools, false))),
  );
  const fullToolDigests = requestToolSchemas.map((tools) =>
    sha256Hex(canonicalJson(normalizedTools(tools, true))),
  );
  if (new Set(commonToolDigests).size > 1 || new Set(fullToolDigests).size > 1) {
    invalid = true;
  }
  for (const event of events.filter((candidate) => candidate.type === "request/context")) {
    const context = recordData(event);
    if (context.provider !== "openai-codex" || context.model !== "gpt-5.6-sol") invalid = true;
  }

  if (!validLifecycle(events)) invalid = true;

  const goalEvents = events.filter((event) => event.type === "goal/change");
  for (const event of goalEvents) {
    const data = recordData(event);
    if (data.kind !== "goal/change" || data.version !== 1 || typeof data.operation !== "string") {
      invalid = true;
      continue;
    }
    if (data.operation === "clear") continue;
    const goal = data.goal;
    if (
      !isRecord(goal) ||
      !["complete", "blocked", "paused", "active"].includes(String(goal.phase)) ||
      !Number.isSafeInteger(data.roundsStarted) ||
      (data.roundsStarted as number) < 0
    ) {
      invalid = true;
    }
  }

  const toolCalls: Record<string, number> = {};
  const callNames = new Map<string, string>();
  for (const event of events.filter((candidate) => candidate.type === "tool/call")) {
    const data = recordData(event);
    if (
      typeof data.callId !== "string" ||
      typeof data.name !== "string" ||
      typeof data.arguments !== "string" ||
      callNames.has(data.callId)
    ) {
      invalid = true;
      continue;
    }
    callNames.set(data.callId, data.name);
    toolCalls[data.name] = (toolCalls[data.name] ?? 0) + 1;
  }
  const seenResults = new Set<string>();
  let failedToolCalls = 0;
  for (const event of events.filter((candidate) => candidate.type === "tool/result")) {
    const data = recordData(event);
    const callId = resultCallId(data);
    if (callId === undefined || !callNames.has(callId) || seenResults.has(callId)) {
      invalid = true;
      continue;
    }
    seenResults.add(callId);
    if (data.error !== undefined || modelFacingToolError(data)) failedToolCalls += 1;
  }
  if ([...callNames.keys()].some((callId) => !seenResults.has(callId))) invalid = true;

  const assistantMessages = events.filter((event) => event.type === "assistant/message");
  const usageRows = assistantMessages.map(usageRecord);
  const usageComplete = usageRows.every((usage) => usage !== undefined);
  if (usageRows.some((usage) => usage !== undefined && !validUsage(usage))) invalid = true;
  if (!usageComplete) {
    reasons.push({
      code: "USAGE_MISSING",
      severity: "warning",
      message: "At least one assistant step omitted usage evidence.",
      evidence_refs: [],
    });
  }
  const sumUsage = (read: (usage: Record<string, unknown>) => number): number | null => {
    if (!usageComplete) return null;
    return (usageRows as Record<string, unknown>[]).reduce((sum, usage) => sum + read(usage), 0);
  };

  const lastGoalEvent = goalEvents.at(-1);
  const lastGoalData = lastGoalEvent === undefined ? {} : recordData(lastGoalEvent);
  const lastGoalSnapshot = isRecord(lastGoalData.goal) ? lastGoalData.goal : {};
  const allowedPhases = new Set(["complete", "blocked", "paused", "active"]);
  const phase =
    lastGoalData.operation === "clear"
      ? "none"
      : typeof lastGoalSnapshot.phase === "string" && allowedPhases.has(lastGoalSnapshot.phase)
        ? (lastGoalSnapshot.phase as "complete" | "blocked" | "paused" | "active")
        : "none";

  if (invalid) {
    reasons.unshift({
      code: "SESSION_EVIDENCE_INVALID",
      severity: "error",
      message: "Session evidence is incomplete or incompatible.",
      evidence_refs: [],
    });
  }
  const lastText = assistantMessages
    .map(assistantText)
    .filter((text) => text !== undefined)
    .at(-1);
  const completionClaim = terminalClaim(lastText);
  if (completionClaim === "absent") {
    reasons.push({
      code: "COMPLETION_CLAIM_MISSING",
      severity: "warning",
      message: "The final assistant text did not contain a frozen completion token.",
      evidence_refs: [],
    });
  }
  const costStatus = invalid ? "invalid" : usageComplete ? "valid" : "insufficient";
  const overall = invalid
    ? "invalid"
    : !usageComplete || completionClaim === "absent"
      ? "insufficient"
      : "valid";
  return {
    measurement_validity: {
      overall,
      dimensions: {
        outcome: invalid ? "invalid" : "valid",
        mechanism: invalid ? "invalid" : "valid",
        cost: costStatus,
      },
      reasons,
    },
    completion_claim: completionClaim,
    mechanism: {
      goal_created: goalEvents.some((event) => recordData(event).operation === "create"),
      goal_rounds_started: goalEvents.reduce((maximum, event) => {
        const value = recordData(event).roundsStarted;
        return typeof value === "number" && Number.isSafeInteger(value)
          ? Math.max(maximum, value)
          : maximum;
      }, 0),
      goal_terminal_phase: phase,
      tool_calls: Object.fromEntries(
        Object.entries(toolCalls).sort(([left], [right]) => left.localeCompare(right)),
      ),
      turns: events.filter((event) => event.type === "turn/start").length,
      steps: events.filter((event) => event.type === "step/start").length,
    },
    cost: {
      input_tokens: sumUsage((usage) => usage.inputTokens as number),
      cached_input_tokens: sumUsage(
        (usage) =>
          ((usage.cacheReadTokens as number | undefined) ?? 0) +
          ((usage.cacheWriteTokens as number | undefined) ?? 0),
      ),
      output_tokens: sumUsage((usage) => usage.outputTokens as number),
      failed_tool_calls: failedToolCalls,
    },
    deployment: {
      common_tool_schema_sha256: commonToolDigests.at(-1) ?? sha256Hex(canonicalJson([])),
      full_tool_schema_sha256: fullToolDigests.at(-1) ?? sha256Hex(canonicalJson([])),
      tool_names: (requestToolSchemas.at(-1) ?? [])
        .map((tool) => (isRecord(tool) ? tool.name : undefined))
        .filter((name): name is string => typeof name === "string")
        .sort(),
    },
  };
}
