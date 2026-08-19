export const EXIT_CODE = {
  OK: 0,
  USAGE_OR_CONTRACT: 2,
  RUNTIME_NOT_READY: 10,
  CARRIER_QUALIFICATION_FAILED: 11,
  VARIANT_COMPOSITION_INVALID: 12,
  CAMPAIGN_INFRASTRUCTURE_INVALID: 13,
  CALIBRATION_NOT_READY: 14,
  ARTIFACT_INTEGRITY_FAILURE: 15,
  DOMAIN_TRUTH_NOT_READY: 16,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export type AppInvocation =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "init" }
  | { readonly kind: "auth-status" }
  | { readonly kind: "auth-login" }
  | { readonly kind: "doctor" }
  | { readonly kind: "calibrate" }
  | {
      readonly kind: "run";
      readonly timeoutMs: number;
      readonly keepWorkspaces: true;
    }
  | { readonly kind: "report"; readonly campaignId: string }
  | { readonly kind: "binding-show" }
  | { readonly kind: "suite-run"; readonly timeoutMs: number }
  | { readonly kind: "suite-report"; readonly suiteId: string }
  | { readonly kind: "domain-validate"; readonly packPath: string; readonly manifestPath: string }
  | {
      readonly kind: "domain-impact";
      readonly packPath: string;
      readonly manifestPath: string;
      readonly claimId: string;
    }
  | {
      readonly kind: "domain-authority";
      readonly packPath: string;
      readonly targetKind:
        | "evidence_card"
        | "product_domain_contract"
        | "requirement_change_set"
        | "decision_question";
      readonly candidatePath: string;
      readonly actorId: string;
    };

const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_TIMEOUT_MS = 2_700_000;
const MAX_TIMEOUT_MS = 5_400_000;

function parsePackPath(value: string | undefined): string {
  if (
    value === undefined ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new AppUsageError("domain pack path must be normalized and project-relative");
  }
  return value;
}

export class AppUsageError extends Error {
  readonly exitCode = EXIT_CODE.USAGE_OR_CONTRACT;

  constructor(message: string) {
    super(message);
    this.name = "AppUsageError";
  }
}

function requireNoArguments(command: string, rest: readonly string[]): void {
  if (rest.length > 0) throw new AppUsageError(`${command} does not accept arguments`);
}

function parseRunArguments(args: readonly string[]): AppInvocation {
  const seen = new Set<string>();
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) break;
    if (seen.has(argument)) throw new AppUsageError(`run option may only appear once: ${argument}`);

    switch (argument) {
      case "--keep-workspaces":
        seen.add(argument);
        break;
      case "--timeout-ms": {
        seen.add(argument);
        const value = args[index + 1];
        if (value === undefined || !/^[1-9]\d*$/.test(value)) {
          throw new AppUsageError("--timeout-ms requires a positive integer");
        }
        timeoutMs = Number(value);
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) {
          throw new AppUsageError(`--timeout-ms must not exceed ${MAX_TIMEOUT_MS}`);
        }
        index += 1;
        break;
      }
      default:
        throw new AppUsageError(`unknown run option: ${argument}`);
    }
  }

  return { kind: "run", timeoutMs, keepWorkspaces: true };
}

function parseSuiteRunArguments(args: readonly string[]): AppInvocation {
  if (args.length === 0) return { kind: "suite-run", timeoutMs: DEFAULT_TIMEOUT_MS };
  if (args.length !== 2 || args[0] !== "--timeout-ms") {
    throw new AppUsageError("suite run accepts only --timeout-ms <positive integer>");
  }
  const value = args[1];
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    throw new AppUsageError("--timeout-ms requires a positive integer");
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) {
    throw new AppUsageError(`--timeout-ms must not exceed ${MAX_TIMEOUT_MS}`);
  }
  return { kind: "suite-run", timeoutMs };
}

export function parseAppArguments(args: readonly string[]): AppInvocation {
  const [command, ...rest] = args;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    requireNoArguments(command ?? "help", rest);
    return { kind: "help" };
  }
  if (command === "--version" || command === "-V") {
    requireNoArguments(command, rest);
    return { kind: "version" };
  }

  switch (command) {
    case "init":
    case "doctor":
    case "calibrate":
      requireNoArguments(command, rest);
      return { kind: command };
    case "auth":
      if (rest.length !== 1) throw new AppUsageError("auth requires exactly one subcommand");
      if (rest[0] === "status") return { kind: "auth-status" };
      if (rest[0] === "login") return { kind: "auth-login" };
      throw new AppUsageError("auth requires status or login");
    case "run":
      return parseRunArguments(rest);
    case "binding":
      if (rest.length !== 1 || rest[0] !== "show") {
        throw new AppUsageError("binding requires exactly the show subcommand");
      }
      return { kind: "binding-show" };
    case "suite": {
      const [subcommand, ...suiteRest] = rest;
      if (subcommand === "run") return parseSuiteRunArguments(suiteRest);
      if (
        subcommand === "report" &&
        suiteRest.length === 1 &&
        suiteRest[0] !== undefined &&
        CAMPAIGN_ID_PATTERN.test(suiteRest[0])
      ) {
        return { kind: "suite-report", suiteId: suiteRest[0] };
      }
      throw new AppUsageError("suite requires run or report <suite-id>");
    }
    case "domain": {
      const [subcommand, packPathValue, third, fourth, fifth, ...domainRest] = rest;
      const packPath = parsePackPath(packPathValue);
      if (subcommand === "validate" && third !== undefined && fourth === undefined) {
        return { kind: "domain-validate", packPath, manifestPath: parsePackPath(third) };
      }
      if (
        subcommand === "impact" &&
        third !== undefined &&
        fourth !== undefined &&
        CAMPAIGN_ID_PATTERN.test(fourth) &&
        fifth === undefined &&
        domainRest.length === 0
      ) {
        return {
          kind: "domain-impact",
          packPath,
          manifestPath: parsePackPath(third),
          claimId: fourth,
        };
      }
      const targetKinds = [
        "evidence_card",
        "product_domain_contract",
        "requirement_change_set",
        "decision_question",
      ] as const;
      if (
        subcommand === "confirm" &&
        third !== undefined &&
        (targetKinds as readonly string[]).includes(third) &&
        fourth !== undefined &&
        fifth !== undefined &&
        CAMPAIGN_ID_PATTERN.test(fifth) &&
        domainRest.length === 0
      ) {
        return {
          kind: "domain-authority",
          packPath,
          targetKind: third as (typeof targetKinds)[number],
          candidatePath: parsePackPath(fourth),
          actorId: fifth,
        };
      }
      throw new AppUsageError(
        "domain requires validate/impact with an exact manifest or confirm with a supported target",
      );
    }
    case "report": {
      if (rest.length !== 1 || rest[0] === undefined || !CAMPAIGN_ID_PATTERN.test(rest[0])) {
        throw new AppUsageError("report requires one valid campaign id");
      }
      return { kind: "report", campaignId: rest[0] };
    }
    default:
      throw new AppUsageError(`unknown command: ${command}`);
  }
}
