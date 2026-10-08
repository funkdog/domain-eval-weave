import assert from "node:assert/strict";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonDigest } from "../../packages/weave/src/canonical-json.ts";
import {
  evaluateJanitorSubmission,
  materializeJanitorTask,
  replayJanitorRun,
  runJanitorWorkspaceCommand,
  submitJanitorSource,
} from "../lib/janitor-coding-task.mjs";
import { gradeJanitorEvidence } from "../lib/janitor-observations.mjs";

const template = process.env.JANITOR_TASK_ROOT;
assert.ok(template, "JANITOR_TASK_ROOT must name the isolated frozen Janitor task");
const task = JSON.parse(await readFile(join(template, "control/task.json"), "utf8"));
const preparation = JSON.parse(await readFile(join(template, "control/preparation.json"), "utf8"));

test("retained observations reproduce the vector; missing, duplicate and malformed output are invalid", () => {
  const reference = preparation.observations[0],
    regression = preparation.observations[1];
  assert.equal(gradeJanitorEvidence(task.contract, reference).verdict, "pass");
  assert.deepEqual(
    gradeJanitorEvidence(task.contract, regression)
      .checks.filter((c) => c.verdict === "fail")
      .map((c) => c.scenario),
    ["concurrent_capture"],
  );
  for (const change of [
    (x) => {
      x.execution.stdout = "";
    },
    (x) => {
      const lines = x.execution.stdout.trim().split("\n");
      lines.splice(2, 0, lines[1]);
      x.execution.stdout = lines.join("\n");
    },
    (x) => {
      x.execution.stdout = x.execution.stdout.replace('"trace":[', '"trace":null,"unused":[');
    },
    (x) => {
      x.execution.timedOut = true;
    },
    (x) => {
      x.compile.exitCode = 1;
    },
  ]) {
    const changed = structuredClone(reference);
    change(changed);
    const result = gradeJanitorEvidence(task.contract, changed);
    assert.equal(result.measurement_validity, "invalid");
    assert.equal(result.verdict, "inconclusive");
  }
});

test("submission binds source bytes, evaluation ignores later edits, and replay recomputes the result", async () => {
  const instance = await materializeJanitorTask(template);
  const source = join(instance.workspace, task.contract.editable_source);
  const baseline = await submitJanitorSource(instance.root);
  const failed = await evaluateJanitorSubmission(instance.root, baseline.digest);
  assert.equal(failed.result.verdict, "fail");
  assert.deepEqual(await replayJanitorRun(failed.path), failed.result);
  const assessment = JSON.parse(
    await readFile(join(template, "control/development-evidence.json"), "utf8"),
  );
  await writeFile(source, assessment.source_snapshots.authored_equivalent);
  const equivalent = await submitJanitorSource(instance.root);
  assert.equal(baseline.task_digest, equivalent.task_digest);
  assert.notEqual(baseline.digest, equivalent.digest);
  await writeFile(source, "not Java: evaluator must use the submitted snapshot");
  const passed = await evaluateJanitorSubmission(instance.root, equivalent.digest);
  assert.equal(passed.result.verdict, "pass");
  assert.equal(passed.result.qualification, "not_qualified");
  assert.equal(passed.result.agent_execution, "not_observed");
  assert.deepEqual(await replayJanitorRun(passed.path), passed.result);
  const forged = JSON.parse(await readFile(passed.path, "utf8"));
  forged.result.verdict = "fail";
  const { digest: _digest, ...body } = forged;
  forged.digest = canonicalJsonDigest(body);
  const forgedPath = join(instance.root, "control/runs", `${forged.digest}.json`);
  await writeFile(forgedPath, JSON.stringify(forged));
  await assert.rejects(replayJanitorRun(forgedPath), /replayed result differs/);
  console.log(
    JSON.stringify({
      evidence: "janitor-submission-flow",
      root: instance.root,
      fail_run: failed.digest,
      pass_run: passed.digest,
    }),
  );
});

test("protected bytes and symlink inputs are rejected before submission", async () => {
  const instance = await materializeJanitorTask(template);
  await writeFile(join(instance.workspace, "TASK.md"), "changed protected input");
  await assert.rejects(submitJanitorSource(instance.root), /protected input drift/);
  const linked = await materializeJanitorTask(template);
  await symlink(join(linked.root, "control"), join(linked.workspace, "extra-link"));
  await assert.rejects(submitJanitorSource(linked.root), /symlink|unexpected/);
});

test("actual workspace sandbox permits public work and denies control reads/writes and network", async () => {
  const instance = await materializeJanitorTask(template);
  const privatePath = join(instance.root, "control/task.json");
  const before = await readFile(privatePath);
  const code = `const fs=require("node:fs"),net=require("node:net");
    console.log(fs.readFileSync("TASK.md","utf8").length>0?"PUBLIC_OK":"PUBLIC_BAD");
    fs.writeFileSync("build/public-check.txt","synthetic");
    for(const [name,path] of ${JSON.stringify([
      ["PRIVATE", privatePath],
      ["ALIAS", `/System/Volumes/Data${privatePath}`],
      [
        "REPO",
        "/Users/slipshod/AIBuild/dsh-eval-lab-public-domain-research/scripts/fixtures/JanitorProbe.java",
      ],
    ])}){
      try{fs.readFileSync(path);console.log(name+"_LEAK")}catch(e){console.log(name+"_DENIED:"+e.code)}
    }
    try{fs.writeFileSync(${JSON.stringify(privatePath)},"changed");console.log("WRITE_LEAK")}catch(e){console.log("WRITE_DENIED:"+e.code)}
    const socket=net.createConnection({host:"127.0.0.1",port:9});socket.on("error",e=>console.log("NET:"+e.code));socket.on("connect",()=>{console.log("NET_LEAK");socket.destroy()});`;
  const command = `${JSON.stringify(process.execPath)} -e '${code.replaceAll("'", "'\\''")}'`;
  const result = await runJanitorWorkspaceCommand(instance.root, command);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /PUBLIC_OK/);
  for (const label of ["PRIVATE", "ALIAS", "REPO", "WRITE"])
    assert.match(result.stdout, new RegExp(`${label}_DENIED:(EACCES|EPERM|ENOENT)`));
  assert.match(result.stdout, /NET:(EACCES|EPERM)/);
  assert.ok(before.equals(await readFile(privatePath)));
  console.log(
    JSON.stringify({ evidence: "janitor-workspace-isolation", root: instance.root, result }),
  );
});
