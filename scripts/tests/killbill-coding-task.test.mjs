import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { before } from "node:test";

import {
  evaluateSubmission,
  prepareCodingTask,
  replayCodingRun,
  runWorkspaceCommand,
  submitCodingSource,
} from "../lib/killbill-coding-task.mjs";
import { candidateName, loadStatusSources } from "../lib/killbill-status-profile.mjs";

let prepared;
let variants;
let sourceFile;
before(async () => {
  assert.ok(process.env.KILLBILL_DEPS_DIR, "set KILLBILL_DEPS_DIR to pinned public JAR directory");
  assert.ok(process.env.KILLBILL_JDK_HOME, "set KILLBILL_JDK_HOME to the supported JDK");
  const parent = await mkdtemp("/Users/slipshod/AIBuild/dsh-eval-lab-runtime/coding-flow-test.");
  prepared = await prepareCodingTask({
    parentRoot: parent,
    dependencyRoot: process.env.KILLBILL_DEPS_DIR,
    jdkHome: process.env.KILLBILL_JDK_HOME,
  });
  ({ variants } = await loadStatusSources());
  sourceFile = join(prepared.workspace, "src", candidateName);
});

test("task stays frozen across new source submissions and evaluation reads the immutable snapshot", async () => {
  assert.deepEqual((await readdir(prepared.workspace)).sort(), [
    "ENVIRONMENT.json",
    "LICENSE",
    "TASK.md",
    "build",
    "lib",
    "src",
  ]);
  const initial = await submitCodingSource(prepared.root);
  const broken = await evaluateSubmission(prepared.root, initial.digest);
  assert.equal(broken.result.verdict, "fail");
  assert.equal(broken.result.measurement_validity, "valid");
  assert.equal(broken.result.mismatches.length, 2);
  const equivalentWithLogging = variants.authored_equivalent.replaceAll(
    "final PaymentPluginStatus status =",
    'System.out.println("debug: converting plugin status");\n        final PaymentPluginStatus status =',
  );
  await writeFile(sourceFile, equivalentWithLogging);
  const repaired = await submitCodingSource(prepared.root);
  assert.equal(initial.task_digest, repaired.task_digest);
  assert.notEqual(initial.digest, repaired.digest);
  await writeFile(sourceFile, "not Java anymore; evaluation must not read this live file");
  const accepted = await evaluateSubmission(prepared.root, repaired.digest);
  assert.equal(accepted.result.verdict, "pass");
  assert.equal(accepted.result.claim_scope, "component_code_artifact_only");
  assert.equal(accepted.result.qualification, "not_qualified");
  assert.equal(accepted.result.agent_execution, "not_observed");
  assert.deepEqual(await replayCodingRun(accepted.path), accepted.result);
  const invalidJava = await submitCodingSource(prepared.root);
  const compileFailed = await evaluateSubmission(prepared.root, invalidJava.digest);
  assert.equal(compileFailed.result.verdict, "fail");
  assert.equal(compileFailed.result.measurement_validity, "valid");
  assert.equal(compileFailed.result.diagnostic, "candidate_compile_failure");
});

test("workspace command can read public inputs but cannot read or write the private control plane", async () => {
  const privateFile = join(prepared.root, "control", "task.json");
  const original = await readFile(privateFile, "utf8");
  const code = `const fs=require("node:fs");
    console.log(fs.readFileSync("TASK.md","utf8").length>0?"PUBLIC_OK":"PUBLIC_BAD");
    try{fs.readFileSync(${JSON.stringify(privateFile)});console.log("READ_LEAK")}catch(e){console.log("READ_DENIED:"+e.code)}
    try{fs.readFileSync(${JSON.stringify(`/System/Volumes/Data${privateFile}`)});console.log("ALIAS_LEAK")}catch(e){console.log("ALIAS_DENIED:"+e.code)}
    try{fs.writeFileSync(${JSON.stringify(privateFile)},"changed");console.log("WRITE_LEAK")}catch(e){console.log("WRITE_DENIED:"+e.code)}`;
  const command = `${JSON.stringify(process.execPath)} -e '${code.replaceAll("'", "'\\''")}'`;
  const result = await runWorkspaceCommand(prepared.root, command);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /PUBLIC_OK/);
  assert.match(result.stdout, /READ_DENIED:(EACCES|EPERM)/);
  assert.match(result.stdout, /ALIAS_DENIED:(EACCES|EPERM|ENOENT)/);
  assert.match(result.stdout, /WRITE_DENIED:(EACCES|EPERM)/);
  assert.equal(await readFile(privateFile, "utf8"), original);
});

test("changed protected inputs and workspace symlinks are rejected before admission", async () => {
  const taskPath = join(prepared.workspace, "TASK.md");
  const original = await readFile(taskPath, "utf8");
  await writeFile(taskPath, `${original}\nchanged`);
  await assert.rejects(submitCodingSource(prepared.root), /protected input drift/);
  await writeFile(taskPath, original);
  await symlink(join(prepared.root, "control"), join(prepared.workspace, "unexpected-link"));
  await assert.rejects(submitCodingSource(prepared.root), /symlink|unexpected/);
});

test("fabricated stdout followed by premature exit cannot produce a passing observation", async () => {
  // A separate workspace avoids relying on cleanup of previous tampering evidence.
  const second = await prepareCodingTask({
    parentRoot: prepared.root,
    dependencyRoot: process.env.KILLBILL_DEPS_DIR,
    jdkHome: process.env.KILLBILL_JDK_HOME,
  });
  const source = variants.upstream_reference.replace(
    "public class PaymentTransactionInfoPluginConverter {",
    `public class PaymentTransactionInfoPluginConverter {
      static { System.out.println("NULL_STATUS\\ttransaction\\tUNKNOWN"); System.exit(0); }`,
  );
  await writeFile(join(second.workspace, "src", candidateName), source);
  const submission = await submitCodingSource(second.root);
  const run = await evaluateSubmission(second.root, submission.digest);
  assert.equal(run.result.verdict, "inconclusive");
  assert.equal(run.result.measurement_validity, "invalid");
  assert.equal(run.result.diagnostic, "observation_protocol_incomplete");
});
