import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidateSandboxPlan } from "../../src/evaluator/index.js";

const common = {
  capsuleRoot: "/workspace/capsule",
  candidateRoot: "/workspace/capsule/candidates/gold",
  scratchRoot: "/workspace/capsule/.eval/tmp/gold-1",
  command: { executable: "/usr/bin/node", args: ["candidate.mjs"] },
};

test("Linux Candidate plan uses a no-network bubblewrap closure", () => {
  const plan = buildCandidateSandboxPlan({
    ...common,
    platform: "linux",
    sandboxExecutable: "/usr/bin/bwrap",
  });
  assert.equal(plan.executable, "/usr/bin/bwrap");
  assert.ok(plan.args.includes("--unshare-all"));
  assert.ok(plan.args.includes("--die-with-parent"));
  assert.ok(plan.args.includes("--new-session"));
  assert.ok(plan.args.includes(common.candidateRoot));
  assert.ok(plan.args.includes(common.scratchRoot));
  assert.equal(plan.args.includes(common.capsuleRoot), false);
  assert.equal(
    Object.keys(plan.env).some((key) => /TOKEN|AUTH|DSH|PROXY/i.test(key)),
    false,
  );
});

test("macOS Candidate plan denies network and Capsule truth", () => {
  const plan = buildCandidateSandboxPlan({
    ...common,
    platform: "darwin",
    sandboxExecutable: "/usr/bin/sandbox-exec",
  });
  const profile = plan.args[1];
  assert.equal(plan.args[0], "-p");
  assert.ok(profile);
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\(deny file-read\* \(subpath "\/Users"\)\)/);
  assert.match(profile, /evaluators/);
  assert.match(profile, /cases/);
  assert.match(profile, /\.eval\/calibrations/);
});

test("Linux Candidate plan mounts a non-system Node runtime read-only", () => {
  const nodeRoot = "/opt/hostedtoolcache/node/24.19.0/x64";
  const plan = buildCandidateSandboxPlan({
    ...common,
    platform: "linux",
    command: { executable: `${nodeRoot}/bin/node`, args: ["candidate.mjs"] },
    sandboxExecutable: "/usr/bin/bwrap",
  });
  const rootIndex = plan.args.indexOf(nodeRoot);
  assert.ok(rootIndex > 0);
  assert.equal(plan.args[rootIndex - 1], "--ro-bind");
  assert.equal(plan.args[rootIndex + 1], nodeRoot);
  assert.ok(plan.args.includes("/opt/hostedtoolcache/node/24.19.0"));
});

test("unsupported Candidate platform fails closed while planning", () => {
  assert.throws(
    () => buildCandidateSandboxPlan({ ...common, platform: "win32" }),
    /CAPSULE_SANDBOX_UNAVAILABLE|unsupported/i,
  );
});
