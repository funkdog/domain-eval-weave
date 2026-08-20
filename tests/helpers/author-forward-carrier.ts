import {
  InternalAuthorForwardCarrier,
  type InternalAuthorForwardCarrierDependencies,
  type InternalAuthorForwardInput,
} from "../../src/carrier/author-forward-internal.js";

export interface TestAuthorForwardInput extends InternalAuthorForwardInput {
  readonly executable: string;
  readonly launcherArgs?: readonly string[];
}

export function createTestAuthorForwardCarrier(
  input: {
    readonly verifyRuntime?: InternalAuthorForwardCarrierDependencies["verifyRuntime"];
  } = {},
) {
  return {
    async run(runInput: TestAuthorForwardInput) {
      const { executable, launcherArgs = [], ...carrierInput } = runInput;
      const carrier = new InternalAuthorForwardCarrier({
        verifyRuntime:
          input.verifyRuntime ??
          (async () => ({
            executable,
            launcherArgs,
            descriptor: {
              node_version: "v24.16.0",
              package_version: "0.1.0-rc.6",
              package_content_sha256: "e".repeat(64),
              package_closure_sha256: "f".repeat(64),
            },
          })),
      });
      return carrier.run(carrierInput);
    },
  };
}
