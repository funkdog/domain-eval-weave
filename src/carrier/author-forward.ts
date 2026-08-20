import { PHASE3A_AUTHOR } from "../instance.js";
import { DEDICATED_DSH_HOME } from "../runtime-root.js";
import {
  type AuthorForwardOutput,
  FORWARD_ACCEPTANCE_ROOT,
  FORWARD_FIXTURE_MANIFEST,
  FORWARD_FIXTURES_ROOT,
  FORWARD_LABELS_ROOT,
  FORWARD_PACKAGES_ROOT,
  InternalAuthorForwardCarrier,
  type InternalAuthorForwardInput,
} from "./author-forward-internal.js";
import { verifyAuthorForwardProductionRuntime } from "./author-forward-production.js";

export {
  FORWARD_ACCEPTANCE_ROOT,
  FORWARD_FIXTURE_MANIFEST,
  FORWARD_FIXTURES_ROOT,
  FORWARD_LABELS_ROOT,
  FORWARD_PACKAGES_ROOT,
};
export type AuthorForwardInput = InternalAuthorForwardInput;
export type { AuthorForwardOutput };

export const FORWARD_DSH_ROOT = `${FORWARD_ACCEPTANCE_ROOT}/dsh-runtime`;
const PINNED_DSH_CONTENT_SHA256 =
  "69bf698a112fe3ca1da8449818282116d5d92fb3760761ab05d638a0a68dbd59";
const PINNED_DSH_CLOSURE_SHA256 =
  "34b7d05995e072d87c59d6fcaa2f36b09055f6ee4433c4fc95205699bfd141a9";

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
  readonly #internal: InternalAuthorForwardCarrier;

  constructor(...dependencies: []) {
    if (dependencies.length !== 0) {
      throw new TypeError("production AuthorForwardCarrier does not accept injected dependencies");
    }
    this.#internal = new InternalAuthorForwardCarrier({
      verifyRuntime: async (input) =>
        verifyAuthorForwardProductionRuntime(input, {
          dshHome: DEDICATED_DSH_HOME,
          authorProfileRoot: `${DEDICATED_DSH_HOME}/profiles/${PHASE3A_AUTHOR.profile}`,
          dshRuntimeRoot: FORWARD_DSH_ROOT,
          nodeExecutable: process.execPath,
          nodeVersion: process.version,
          expectedDshContentSha256: PINNED_DSH_CONTENT_SHA256,
          expectedDshClosureSha256: PINNED_DSH_CLOSURE_SHA256,
        }),
    });
  }

  run(input: AuthorForwardInput): Promise<AuthorForwardOutput> {
    assertProductionInput(input);
    return this.#internal.run(input);
  }
}
