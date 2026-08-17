import { isAbsolute } from "node:path";

export const EXIT_CODE = {
  OK: 0,
  USAGE_OR_CONTRACT: 2,
  RUNTIME_NOT_READY: 10,
  CARRIER_QUALIFICATION_FAILED: 11,
  VARIANT_COMPOSITION_INVALID: 12,
  CAMPAIGN_INFRASTRUCTURE_INVALID: 13,
  CALIBRATION_NOT_READY: 14,
  ARTIFACT_INTEGRITY_FAILURE: 15,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export interface CliIo {
  out(message: string): void;
  err(message: string): void;
}

const defaultIo: CliIo = {
  out: (message) => process.stdout.write(`${message}\n`),
  err: (message) => process.stderr.write(`${message}\n`),
};

const HELP = `DSH Eval Lab (Phase 1)

Usage:
  dsh-eval init
  dsh-eval auth status
  dsh-eval auth login
  dsh-eval doctor
  dsh-eval calibrate
  dsh-eval run
  dsh-eval report <campaign-id>

Milestone 0 provides contracts and command routing only. It does not install or run DSH.`;

function emitUsage(io: CliIo, message: string): ExitCode {
  io.err(
    JSON.stringify({
      code: "CLI_USAGE",
      severity: "error",
      message,
      evidence_refs: [],
    }),
  );
  return EXIT_CODE.USAGE_OR_CONTRACT;
}

function emitMilestoneUnavailable(io: CliIo, exitCode: ExitCode): ExitCode {
  io.err(
    JSON.stringify({
      code: "NOT_IMPLEMENTED_MILESTONE_0",
      severity: "error",
      message: "This command is routed but is not available until its frozen milestone.",
      evidence_refs: [],
    }),
  );
  return exitCode;
}

function validateRunArguments(args: readonly string[]): string | undefined {
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) break;
    if (seen.has(argument)) return `run option may only appear once: ${argument}`;

    switch (argument) {
      case "--keep-workspaces":
        seen.add(argument);
        break;
      case "--runtime-root": {
        seen.add(argument);
        const value = args[index + 1];
        if (value === undefined || !isAbsolute(value)) {
          return "--runtime-root requires an absolute path";
        }
        index += 1;
        break;
      }
      case "--timeout-ms": {
        seen.add(argument);
        const value = args[index + 1];
        if (value === undefined || !/^[1-9]\d*$/.test(value) || Number(value) > 5_400_000) {
          return "--timeout-ms requires an integer from 1 through 5400000";
        }
        index += 1;
        break;
      }
      default:
        return `unknown run option: ${argument}`;
    }
  }

  return undefined;
}

export async function main(args: readonly string[], io: CliIo = defaultIo): Promise<ExitCode> {
  const [command, ...rest] = args;
  if (command === "--help" || command === "-h" || command === "help") {
    io.out(HELP);
    return EXIT_CODE.OK;
  }
  if (command === "--version" || command === "-v") {
    io.out("0.0.0");
    return EXIT_CODE.OK;
  }
  if (command === undefined) {
    return emitUsage(io, "a command is required");
  }

  switch (command) {
    case "init":
    case "doctor":
      if (rest.length > 0) return emitUsage(io, `${command} does not accept arguments yet`);
      return emitMilestoneUnavailable(io, EXIT_CODE.RUNTIME_NOT_READY);
    case "auth":
      if (rest.length !== 1 || (rest[0] !== "status" && rest[0] !== "login")) {
        return emitUsage(io, "auth requires exactly one of: status, login");
      }
      return emitMilestoneUnavailable(io, EXIT_CODE.RUNTIME_NOT_READY);
    case "calibrate":
      if (rest.length > 0) return emitUsage(io, "calibrate does not accept arguments yet");
      return emitMilestoneUnavailable(io, EXIT_CODE.CALIBRATION_NOT_READY);
    case "run":
      {
        const usageError = validateRunArguments(rest);
        if (usageError !== undefined) return emitUsage(io, usageError);
      }
      return emitMilestoneUnavailable(io, EXIT_CODE.CAMPAIGN_INFRASTRUCTURE_INVALID);
    case "report":
      if (
        rest.length !== 1 ||
        rest[0] === undefined ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(rest[0])
      ) {
        return emitUsage(io, "report requires one valid campaign id");
      }
      return emitMilestoneUnavailable(io, EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE);
    default:
      return emitUsage(io, `unknown command: ${command}`);
  }
}
