import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { exportJanitorConsumerKit } from "../lib/janitor-consumer-kit.mjs";

const template = process.env.JANITOR_TASK_ROOT;
assert.ok(template, "JANITOR_TASK_ROOT must be the isolated prepared task");

test("relocated kit works without repository/original artifacts and rejects static file drift", async () => {
  const exported = await exportJanitorConsumerKit(template);
  const exercise = await mkdtemp(
    "/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-exercise.",
  );
  const kit = join(exercise, "copied-kit");
  await cp(exported.root, kit, { recursive: true, errorOnExist: true, force: false });
  await mkdir(join(exercise, "evidence"));
  console.log(JSON.stringify({ exported, exercise }));
  const evidence = [];
  const jdk = "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home";
  // Node fs permissions constrain trusted coordinator I/O without nesting macOS Seatbelt.
  // Children are allowed explicitly: the unchanged evaluator applies OS isolation to Candidate code.
  // This is not an adversarial coordinator sandbox; retain Node's child-process warning.
  const launch = async (directory, args) => {
    const flags = [
      "--permission",
      `--allow-fs-read=${directory}`,
      `--allow-fs-read=${dirname(dirname(process.execPath))}`,
      `--allow-fs-read=${jdk}`,
      `--allow-fs-write=${join(directory, "state")}`,
      "--allow-child-process",
    ];
    const options = {
      cwd: directory,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: "C", LC_ALL: "C" },
      timeout: 60000,
      maxBuffer: 256 * 1024,
      encoding: "utf8",
    };
    try {
      const output = await promisify(execFile)(process.execPath, [...flags, ...args], options);
      return { exitCode: 0, signal: null, ...output, timedOut: false, outputLimitExceeded: false };
    } catch (error) {
      return {
        exitCode: Number.isInteger(error.code) ? error.code : null,
        signal: error.signal ?? null,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
        timedOut: error.killed === true,
        outputLimitExceeded: error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      };
    }
  };
  const command = async (...args) => {
    const process = await launch(kit, [join(kit, "cli.mjs"), ...args]);
    evidence.push({ args, process });
    await writeFile(
      join(exercise, "evidence", `command-${evidence.length}.json`),
      JSON.stringify(evidence.at(-1), null, 2),
      { flag: "wx" },
    );
    assert.equal(process.exitCode, 0, process.stderr);
    assert.equal(process.timedOut, false);
    assert.equal(process.outputLimitExceeded, false);
    return JSON.parse(process.stdout);
  };
  const denied = await launch(kit, [
    "-e",
    `const fs=require("node:fs");for(const p of ${JSON.stringify([join(template, "control/task.json"), "/Users/slipshod/AIBuild/dsh-eval-lab-public-domain-research/package.json", join(exported.root, "kit.json")])}){try{fs.readFileSync(p);console.log("LEAK")}catch(e){console.log(e.code)}}`,
  ]);
  evidence.push({ args: ["original-path-access-check"], process: denied });
  assert.equal(denied.exitCode, 0);
  assert.deepEqual(denied.stdout.trim().split("\n"), [
    "ERR_ACCESS_DENIED",
    "ERR_ACCESS_DENIED",
    "ERR_ACCESS_DENIED",
  ]);
  const doctor = await command("doctor");
  assert.equal(doctor.ready, true);
  const instance = await command("prepare");
  assert.ok(instance.root.startsWith(`${join(kit, "state")}/`));
  assert.equal(instance.task_digest, exported.task_digest);
  const privateCheck = `const fs=require("node:fs");for(const p of ${JSON.stringify([join(kit, "cli.mjs"), join(template, "control/task.json")])}){try{fs.readFileSync(p);console.log("LEAK")}catch(e){console.log(e.code)}}`;
  const privateResult = await command(
    "workspace-exec",
    instance.root,
    `${JSON.stringify(process.execPath)} -e '${privateCheck.replaceAll("'", "'\\''")}'`,
  );
  assert.equal(privateResult.exitCode, 0);
  const deniedCodes = privateResult.stdout.trim().split("\n");
  assert.equal(deniedCodes.length, 2);
  assert.ok(deniedCodes.every((code) => ["EPERM", "EACCES", "ERR_ACCESS_DENIED"].includes(code)));
  const submission = await command("submit", instance.root);
  const run = await command("evaluate", instance.root, submission.digest);
  assert.equal(run.result.measurement_validity, "valid");
  assert.equal(run.result.verdict, "fail"); // A new workspace contains the actual broken task, not an answer.
  assert.deepEqual(
    run.result.checks.filter((c) => c.verdict === "fail").map((c) => c.scenario),
    ["concurrent_capture"],
  );
  assert.deepEqual(await command("replay", run.path), run.result);
  // Isolated tampering copy; the deliverable and successful exercise remain unchanged.
  const tampered = join(exercise, "tampered-kit");
  await cp(exported.root, tampered, { recursive: true, errorOnExist: true, force: false });
  await writeFile(
    join(tampered, "scripts/lib/janitor-observations.mjs"),
    "throw new Error('must not execute');\n",
  );
  const rejected = await launch(tampered, [join(tampered, "cli.mjs"), "doctor"]);
  assert.notEqual(rejected.exitCode, 0);
  assert.match(rejected.stderr, /kit file drift/);
  const manifest = JSON.parse(await readFile(join(exported.root, "kit.json"), "utf8"));
  await writeFile(
    join(exercise, "evidence/result.json"),
    JSON.stringify(
      {
        exported,
        relocated_root: kit,
        manifest,
        evidence,
        tamper_rejection: rejected,
        run,
        real_model_requests: 0,
        independent_consumer_observed: false,
        scope: "same-host-source-independent-rehearsal",
        qualification: "not_qualified",
        coordinator_boundary:
          "Node-fs-permissions-with-explicit-child-process-allowance-not-adversarial-isolation",
        candidate_boundary: "unchanged-macOS-StrictProcessRunner",
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      exported,
      exercise,
      run_digest: run.digest,
      scope: "same-host-source-independent-rehearsal",
      independent_consumer_observed: false,
    }),
  );
});
