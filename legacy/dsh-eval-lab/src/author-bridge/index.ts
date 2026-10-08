import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createForwardAttemptRecorderFromEnv } from "../author-evidence/index.js";
import type { GuardedToolExecution } from "../bridge/guard.js";
import {
  assertCurrentPhase3AuthorProfile,
  assertPhase3AuthorLayout,
  resolvePhase2Instance,
} from "../instance.js";
import { createDomainArtifactDefinition } from "./domain-artifact.js";

export const name = "dsh-eval-author-bridge";
export const inject = ["tools"] as const;

const ALLOWED_PATHLESS_TOOLS = new Set(["skill", "domain_artifact"]);
const EDITOR_COMMANDS = new Set(["view", "create", "str_replace", "insert"]);
const MUTATING_EDITOR_COMMANDS = new Set(["create", "str_replace", "insert"]);
const PROTECTED_DOMAIN_NAMESPACES = new Set([
  "sources",
  "candidates",
  "interviews",
  "evidence-cards",
  "decision-questions",
  "contracts",
  "requirements",
  "graphs",
  "readiness",
  "manifests",
]);

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

export function createAuthorToolGuard(input: {
  readonly workspaceRoot: string;
}): (execution: GuardedToolExecution) => string | undefined {
  const workspaceRoot = realpathSync(input.workspaceRoot);
  const domainRoot = resolve(workspaceRoot, "domain-eval");
  return (execution) => {
    if (ALLOWED_PATHLESS_TOOLS.has(execution.name)) return undefined;
    if (execution.name !== "str_replace_editor") {
      return `tool ${execution.name} is not allowed in the Eval Lab author profile`;
    }
    const command = execution.arguments.command;
    const rawPath = execution.arguments.path;
    if (
      typeof command !== "string" ||
      !EDITOR_COMMANDS.has(command) ||
      typeof rawPath !== "string" ||
      rawPath.includes("\0")
    ) {
      return "author editor command or path is invalid";
    }
    const resolved = canonicalizePotentialPath(
      isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath),
    );
    if (!sameOrNested(workspaceRoot, resolved)) {
      return "author editor path is outside the authorized project workspace";
    }
    if (MUTATING_EDITOR_COMMANDS.has(command) && !sameOrNested(domainRoot, resolved)) {
      return "author writes are allowed only under domain-eval/";
    }
    if (MUTATING_EDITOR_COMMANDS.has(command) && sameOrNested(domainRoot, resolved)) {
      const namespace = relative(domainRoot, resolved).split("/")[0];
      if (namespace !== undefined && PROTECTED_DOMAIN_NAMESPACES.has(namespace)) {
        return "schema-governed domain artifacts must be written with domain_artifact";
      }
    }
    return undefined;
  };
}

export interface DshEvalAuthorBridgeContext {
  readonly root: { readonly baseUrl?: string };
  readonly tools: {
    guard(guard: (execution: GuardedToolExecution) => string | undefined): unknown;
    register(definition: ReturnType<typeof createDomainArtifactDefinition>): unknown;
  };
}

export interface DshEvalAuthorBridgeConfig {
  readonly workspaceRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly assertLayout?: () => Promise<void>;
}

async function applyDshEvalAuthorBridge(
  context: DshEvalAuthorBridgeContext,
  config: DshEvalAuthorBridgeConfig = {},
): Promise<void> {
  const env = config.env ?? process.env;
  resolvePhase2Instance(env);
  assertCurrentPhase3AuthorProfile(context.root.baseUrl);
  await (config.assertLayout ?? assertPhase3AuthorLayout)();
  context.tools.guard(
    createAuthorToolGuard({ workspaceRoot: config.workspaceRoot ?? process.cwd() }),
  );
  const attemptRecorder = await createForwardAttemptRecorderFromEnv(env);
  context.tools.register(
    createDomainArtifactDefinition({
      workspaceRoot: config.workspaceRoot ?? process.cwd(),
      ...(attemptRecorder === undefined ? {} : { attemptRecorder }),
    }),
  );
}

export default Object.assign(applyDshEvalAuthorBridge, { inject });
