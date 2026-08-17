import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const READ_TOOLS = new Set(["read", "read_image", "glob", "grep"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const PATHLESS_TOOLS = new Set(["workspace_test", "todo_write"]);
const GOAL_TOOLS = new Set(["get_goal", "create_goal", "update_goal"]);
const MAX_GOAL_ROUNDS = 8;

export interface GuardedToolExecution {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface WorkspaceToolGuardInput {
  readonly workspaceRoot: string;
}

function sameOrNested(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function canonicalizePotentialPath(path: string): string {
  let existing = path;
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    suffix.unshift(relative(parent, existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...suffix);
}

function toolPath(execution: GuardedToolExecution): string | undefined {
  const path = execution.arguments.path;
  const filePath = execution.arguments.file_path;
  if (path !== undefined && filePath !== undefined) return undefined;
  const value = filePath ?? path;
  if (value === undefined && (execution.name === "glob" || execution.name === "grep")) return ".";
  return typeof value === "string" ? value : undefined;
}

export function createWorkspaceToolGuard(
  input: WorkspaceToolGuardInput,
): (execution: GuardedToolExecution) => string | undefined {
  const workspaceRoot = realpathSync(input.workspaceRoot);
  return (execution) => {
    if (PATHLESS_TOOLS.has(execution.name)) return undefined;
    if (GOAL_TOOLS.has(execution.name)) {
      const maxRounds = execution.arguments.max_goal_rounds;
      if (
        maxRounds !== undefined &&
        (!Number.isSafeInteger(maxRounds) ||
          (maxRounds as number) < 1 ||
          (maxRounds as number) > MAX_GOAL_ROUNDS)
      ) {
        return `max_goal_rounds must be a positive safe integer at most ${MAX_GOAL_ROUNDS}`;
      }
      return undefined;
    }
    if (!READ_TOOLS.has(execution.name) && !WRITE_TOOLS.has(execution.name)) {
      return `tool ${execution.name} is not allowed in the Eval Lab runner`;
    }

    const rawPath = toolPath(execution);
    if (rawPath === undefined || rawPath.includes("\0")) return "tool path is missing or invalid";
    const resolved = canonicalizePotentialPath(
      isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath),
    );
    if (!sameOrNested(workspaceRoot, resolved)) return "tool path is outside the workspace";
    if (WRITE_TOOLS.has(execution.name)) {
      const relation = relative(workspaceRoot, resolved);
      if (relation !== "src" && !relation.startsWith("src/")) {
        return "writes are allowed only under src/";
      }
    }
    return undefined;
  };
}
