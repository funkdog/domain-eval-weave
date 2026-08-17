import assert from "node:assert/strict";
import test from "node:test";

import { AuthContractError, AuthFacade } from "../../src/auth/facade.js";
import { runDoctor } from "../../src/doctor/index.js";

test("auth status accepts only the frozen secret-free contract", async () => {
  const calls: unknown[] = [];
  const auth = new AuthFacade({
    executable: "/runtime/profile/bin/dsh-codex-connect",
    execute: async (input) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout:
          '{"schemaVersion":1,"package":"dsh-codex-connect","version":"0.1.0-alpha.4.7","status":"signed-in"}',
        stderr: "",
      };
    },
  });
  assert.deepEqual(await auth.status(), {
    schemaVersion: 1,
    package: "dsh-codex-connect",
    version: "0.1.0-alpha.4.7",
    status: "signed-in",
  });
  assert.deepEqual(calls, [
    {
      executable: "/runtime/profile/bin/dsh-codex-connect",
      args: ["status", "--json"],
      env: {},
      stdio: "capture",
    },
  ]);

  const leaking = new AuthFacade({
    executable: "/runtime/profile/bin/dsh-codex-connect",
    execute: async () => ({
      exitCode: 0,
      stdout:
        '{"schemaVersion":1,"package":"dsh-codex-connect","version":"0.1.0-alpha.4.7","status":"signed-in","access_token":"secret"}',
      stderr: "",
    }),
  });
  await assert.rejects(leaking.status(), AuthContractError);

  const leakingStderr = new AuthFacade({
    executable: "/runtime/profile/bin/dsh-codex-connect",
    execute: async () => ({
      exitCode: 1,
      stdout:
        '{"schemaVersion":1,"package":"dsh-codex-connect","version":"0.1.0-alpha.4.7","status":"signed-out"}',
      stderr: "device_code=synthetic-forbidden",
    }),
  });
  await assert.rejects(leakingStderr.status(), AuthContractError);
});

test("doctor preserves ordered checks and distinguishes ready from failed", async () => {
  const order: string[] = [];
  const report = await runDoctor([
    { id: "runtime", run: async () => void order.push("runtime") },
    {
      id: "auth",
      run: async () => {
        order.push("auth");
        throw new Error("signed out");
      },
    },
    { id: "variants", run: async () => void order.push("variants") },
  ]);
  assert.deepEqual(order, ["runtime", "auth", "variants"]);
  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.map((check) => check.status),
    ["pass", "fail", "pass"],
  );
  assert.equal(JSON.stringify(report).includes("secret"), false);
});
