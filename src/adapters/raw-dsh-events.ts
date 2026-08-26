import type { TddEvent } from "../phase3c/tdd-binding.js";

interface ToolCall {
  readonly seq: number;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

function parseArguments(input: unknown): Record<string, unknown> {
  if (typeof input !== "string") return {};
  try {
    const value = JSON.parse(input) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseWorkspaceExitCode(block: unknown): number | undefined {
  if (typeof block !== "object" || block === null) return undefined;
  const content = (block as { readonly content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .flatMap((entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { text?: unknown }).text === "string"
        ? [(entry as { text: string }).text]
        : [],
    )
    .join("\n");
  try {
    const parsed = JSON.parse(text) as { readonly exitCode?: unknown };
    return Number.isInteger(parsed.exitCode) ? (parsed.exitCode as number) : undefined;
  } catch {
    return undefined;
  }
}

export function projectRawDshTddEvents(transcript: string): readonly TddEvent[] {
  const rows = transcript
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const calls = new Map<string, ToolCall>();
  const projected: TddEvent[] = [];
  for (const row of rows) {
    const seq = row.seq;
    if (!Number.isSafeInteger(seq) || (seq as number) < 0) continue;
    const data = row.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    const record = data as Record<string, unknown>;
    if (row.type === "tool/call") {
      const callId = record.callId;
      const name = record.name;
      if (typeof callId !== "string" || typeof name !== "string") continue;
      const call: ToolCall = {
        seq: seq as number,
        name,
        arguments: parseArguments(record.arguments),
      };
      calls.set(callId, call);
      if (name === "skill" && call.arguments.name === "tdd") {
        projected.push({ seq: call.seq, type: "skill_loaded", skill_id: "mattpocock-tdd" });
      } else if (name === "skill" && call.arguments.name === "codebase-design") {
        projected.push({
          seq: call.seq,
          type: "dependency_request",
          dependency_id: "codebase-design",
        });
      } else if (name === "write" || name === "edit") {
        const path = call.arguments.file_path;
        if (typeof path === "string") projected.push({ seq: call.seq, type: "file_write", path });
      }
      continue;
    }
    if (row.type !== "tool/result") continue;
    const message = record.message;
    if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
    const blocks = (message as { readonly content?: unknown }).content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      const blockRecord = block as Record<string, unknown>;
      const callId = blockRecord.toolCallId;
      if (typeof callId !== "string") continue;
      const call = calls.get(callId);
      if (call?.name !== "workspace_test") continue;
      const exitCode = parseWorkspaceExitCode(block);
      if (exitCode !== undefined) {
        projected.push({
          seq: seq as number,
          type: "test_run",
          scope: "full",
          exit_code: exitCode,
        });
      }
    }
  }
  return projected.sort((left, right) => left.seq - right.seq);
}
