import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

export interface WorkspaceTestProcessInput {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly purpose: "public-test";
}

export interface WorkspaceTestProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface WorkspaceTestRunner {
  run(input: WorkspaceTestProcessInput): Promise<WorkspaceTestProcessResult>;
}

export interface WorkspaceTestDefinitionInput {
  readonly workspaceRoot: string;
  readonly runner: WorkspaceTestRunner;
}

export function createWorkspaceTestDefinition(input: WorkspaceTestDefinitionInput) {
  return {
    name: "workspace_test",
    description: "Run the fixed public tests for the current coding task.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    } as const,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["exitCode", "stdout", "stderr", "timedOut"],
        properties: {
          exitCode: { oneOf: [{ type: "integer" }, { type: "null" }] },
          stdout: { type: "string" },
          stderr: { type: "string" },
          timedOut: { type: "boolean" },
        },
      },
      render: (_args: unknown, value: unknown) => [
        { type: "text" as const, text: JSON.stringify(value) },
      ],
    },
    async execute(argumentsValue: Readonly<Record<string, never>>) {
      if (
        typeof argumentsValue !== "object" ||
        argumentsValue === null ||
        Array.isArray(argumentsValue) ||
        Object.keys(argumentsValue).length !== 0
      ) {
        throw new Error("workspace_test accepts no arguments");
      }
      const result = await input.runner.run({
        argv: ["node", "--test", "test/public/*.test.ts"],
        cwd: input.workspaceRoot,
        purpose: "public-test",
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      };
    },
  } satisfies ToolDefinition;
}
