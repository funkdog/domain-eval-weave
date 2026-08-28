import {
  type AuthorForwardOutput,
  createProductionAuthorForwardRunner,
  FORWARD_ACCEPTANCE_ROOT,
  FORWARD_DSH_ROOT,
  FORWARD_FIXTURE_MANIFEST,
  FORWARD_FIXTURES_ROOT,
  FORWARD_LABELS_ROOT,
  FORWARD_PACKAGES_ROOT,
  type InternalAuthorForwardInput,
} from "./author-forward-internal.js";

export {
  FORWARD_ACCEPTANCE_ROOT,
  FORWARD_DSH_ROOT,
  FORWARD_FIXTURE_MANIFEST,
  FORWARD_FIXTURES_ROOT,
  FORWARD_LABELS_ROOT,
  FORWARD_PACKAGES_ROOT,
};
export type AuthorForwardInput = InternalAuthorForwardInput;
export type { AuthorForwardOutput };

const INPUT_KEYS = new Set([
  "workspace",
  "task",
  "timeoutMs",
  "postOutputExitGraceMs",
  "evidenceRoot",
  "runId",
  "sourceRevision",
  "packageTarPath",
]);

function assertProductionInput(input: AuthorForwardInput): void {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !INPUT_KEYS.has(key))
  ) {
    throw new TypeError("production AuthorForwardCarrier input contains an unknown field");
  }
}

export class AuthorForwardCarrier {
  readonly #runner: ReturnType<typeof createProductionAuthorForwardRunner>;

  constructor(...dependencies: []) {
    if (dependencies.length !== 0) {
      throw new TypeError("production AuthorForwardCarrier does not accept injected dependencies");
    }
    this.#runner = createProductionAuthorForwardRunner();
  }

  run(input: AuthorForwardInput): Promise<AuthorForwardOutput> {
    assertProductionInput(input);
    return this.#runner.run(input);
  }
}
