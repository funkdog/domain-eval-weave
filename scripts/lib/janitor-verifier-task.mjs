import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StrictProcessRunner } from "../../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import { loadJanitorTask } from "./janitor-coding-task.mjs";
import { fingerprintJdk } from "./killbill-status-profile.mjs";

const runtime = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const domain = join(repo, "packages/weave/examples/killbill-orchestration");
const assets = join(repo, "packages/weave/examples/killbill-janitor-money-acceptance");
const priorRevision = "9ba1708"; // Ancestor of task selection, not a package assembled from its answers.
const verifierPath = "src/JanitorProbe.java";
const targetPath = "src/IncompletePaymentTransactionTask.java";
const envelope = (body) => ({ ...body, digest: canonicalJsonDigest(body) });
const checked = (value) => {
  const { digest, ...body } = value;
  assert.equal(canonicalJsonDigest(body), digest, "artifact digest mismatch");
  return body;
};
async function insideRuntime(path) {
  const physical = await realpath(path);
  assert.equal(physical, resolve(path), "symlink path denied");
  const rel = relative(await realpath(runtime), physical);
  assert.ok(rel && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/"));
  return physical;
}
async function stableBytes(path, max = 32 * 1024 * 1024) {
  assert.equal(await realpath(path), resolve(path), "symlink input denied");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const a = await handle.stat();
    assert.ok(a.isFile() && a.nlink === 1 && a.size <= max, "bounded single-link file required");
    const bytes = await handle.readFile(),
      b = await handle.stat();
    assert.ok(
      a.size === bytes.length &&
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs &&
        a.ctimeMs === b.ctimeMs,
    );
    return bytes;
  } finally {
    await handle.close();
  }
}
const json = async (path) => JSON.parse((await stableBytes(path)).toString("utf8"));
async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(
    path,
    Buffer.from(bytes),
    () => new Error("immutable verifier artifact collision"),
  );
}
const putJson = (path, value) => put(path, `${canonicalJson(value)}\n`);
const implementationPin = async () => sha256Hex(await readFile(new URL(import.meta.url)));

const wrapper = `import java.io.PrintStream;
import java.util.UUID;
import java.lang.reflect.InvocationTargetException;
public final class WeaveVerifierMain {
  public static void main(String[] args) {
    final PrintStream out = System.out;
    final String nonce = UUID.randomUUID().toString();
    out.println("BEGIN\\t" + nonce);
    String outcome = "invalid";
    try {
      Class.forName("org.killbill.billing.payment.core.janitor.JanitorProbe")
        .getMethod("main", String[].class).invoke(null, (Object) new String[]{args[0]});
      outcome = "accepted";
    } catch (InvocationTargetException e) {
      if (e.getCause() instanceof AssertionError) outcome = "rejected";
      else e.getCause().printStackTrace(System.err);
    } catch (Throwable e) { e.printStackTrace(System.err); }
    out.println(nonce + "\\tVERDICT\\t" + outcome);
    out.println("END\\t" + nonce);
  }
}
`;

export function parseVerifierProcess(p) {
  if (
    p?.exitCode !== 0 ||
    p.signal !== null ||
    p.timedOut ||
    p.outputLimitExceeded ||
    typeof p.stdout !== "string"
  )
    return "invalid";
  const lines = p.stdout.trim().split("\n"),
    start = lines[0]?.split("\t"),
    nonce = start?.[1];
  if (
    start?.length !== 2 ||
    start[0] !== "BEGIN" ||
    !/^[0-9a-f-]{36}$/.test(nonce ?? "") ||
    lines.at(-1) !== `END\t${nonce}`
  )
    return "invalid";
  const rows = lines.slice(1, -1).filter((l) => l.startsWith(`${nonce}\t`));
  if (rows.length !== 1) return "invalid";
  const [token, kind, outcome, extra] = rows[0].split("\t");
  return token === nonce &&
    kind === "VERDICT" &&
    !extra &&
    ["accepted", "rejected"].includes(outcome)
    ? outcome
    : "invalid";
}
export function classifyVerifierMatrix(rows) {
  const valid =
    rows.length > 0 &&
    new Set(rows.map((r) => r.id)).size === rows.length &&
    rows.every(
      (r) =>
        ["accepted", "rejected"].includes(r.observed) &&
        ["accepted", "rejected"].includes(r.expected),
    );
  return {
    measurement_validity: valid ? "valid" : "invalid",
    fits_selected_samples: valid && rows.every((r) => r.observed === r.expected),
    false_accepts: rows
      .filter((r) => r.expected === "rejected" && r.observed === "accepted")
      .map((r) => r.id),
    false_rejects: rows
      .filter((r) => r.expected === "accepted" && r.observed === "rejected")
      .map((r) => r.id),
    invalid_samples: rows.filter((r) => r.observed === "invalid").map((r) => r.id),
  };
}

function assertionMethod(expected, method = "checkLegacy") {
  const cases = Object.entries(expected)
    .map(([name, fields]) => {
      const assertions = Object.entries(fields)
        .map(([field, value]) => {
          const actual = `row.get(${JSON.stringify(field)})`;
          const predicate =
            field === "processed_amount"
              ? `${actual} != null && new java.math.BigDecimal(${actual}.toString()).compareTo(new java.math.BigDecimal(${JSON.stringify(String(value))})) == 0`
              : `java.util.Objects.equals(${actual}, ${JSON.stringify(value)})`;
          return `if (!(${predicate})) throw new AssertionError(${JSON.stringify(`${name}:${field}`)});`;
        })
        .join("\n");
      return `case ${JSON.stringify(name)}: { ${assertions} break; }`;
    })
    .join("\n");
  return `static void ${method}(Map<String,Object> row) { switch ((String)row.get("scenario")) {\n${cases}\ndefault: throw new AssertionError("unexpected case");\n} }\n`;
}
function addLegacyAssertions(base, expected) {
  const anchor = 'System.out.println(token + "\\t" + json(run(scenario)));';
  assert.equal(base.split(anchor).length, 2);
  const method = "    public static void main(String[] args) throws Exception {";
  assert.equal(base.split(method).length, 2);
  return base
    .replace(method, `${assertionMethod(expected)}\n${method}`)
    .replace(
      anchor,
      '{ Map<String,Object> row = run(scenario); checkLegacy(row); System.out.println(token + "\\t" + json(row)); }',
    );
}
function referenceVerifier(base, money, expectations) {
  const from = money.indexOf("    static Map<String, Object> money("),
    to = money.indexOf("    public static void main(");
  assert.ok(from > 0 && to > from);
  const names = Object.keys(expectations);
  const main = `public static void main(String[] args) throws Exception {
    legacyMain(args);
    for(String scenario : java.util.List.of(${names.map((s) => JSON.stringify(s)).join(",")})) checkMoney(money(scenario));
  }`;
  return base
    .replace("public static void main(String[] args)", "static void legacyMain(String[] args)")
    .replace(
      /}\s*$/,
      `${money.slice(from, to)}\n${assertionMethod(expectations, "checkMoney")}\n${main}\n}\n`,
    );
}

export async function prepareVerifierTrial(templateRoot, probeRoot) {
  const { root: oldRoot, task } = await loadJanitorTask(templateRoot);
  assert.equal(task.digest, "6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8");
  probeRoot = await insideRuntime(probeRoot);
  const probeEnvelope = await json(join(probeRoot, "report.json")),
    probe = checked(probeEnvelope);
  assert.equal(
    probeEnvelope.digest,
    "0bbc4d7d53ad430016e6f33316c6b587440b1f70cab1779e46a6b7efbb14fa91",
  );
  assert.equal(probe.author_calibration_passed, true);
  const lock = await json(join(domain, "release.lock.json"));
  assert.equal(
    lock.module_digest,
    "b4197c43db0d393e480d12874ce76c0db6d9c51187c99a4c6e4b009fa718d215",
  );
  const domainFiles = {};
  for (const [path, digest] of Object.entries(lock.files)) {
    if (!(path.startsWith("sources/") || path.startsWith("docs/") || path === "module.yaml"))
      continue;
    const bytes = await stableBytes(join(domain, path));
    assert.equal(sha256Hex(bytes), digest);
    const prior = execFileSync(
      "git",
      ["show", `${priorRevision}:packages/weave/examples/killbill-orchestration/${path}`],
      { cwd: repo, maxBuffer: 32 * 1024 * 1024 },
    );
    assert.equal(sha256Hex(prior), digest, `knowledge was not present at cutoff: ${path}`);
    domainFiles[path] = bytes;
  }
  const root = await mkdtemp(join(await realpath(runtime), "janitor-knowledge-trial."));
  const baseline = addLegacyAssertions(task.oracle.driver, task.contract.expected);
  const samples = {};
  for (const [name, digest] of Object.entries(probe.frozen_input.variants)) {
    const source = await stableBytes(
      join(probeRoot, name, "IncompletePaymentTransactionTask.java"),
    );
    assert.equal(sha256Hex(source), digest);
    samples[name] = {
      source: source.toString("utf8"),
      expected: name.endsWith("default") ? "rejected" : "accepted",
    };
  }
  assert.equal(task.contract.baseline_variant, "stale_snapshot_regression");
  samples.stale_snapshot_regression = { source: task.baseline_source, expected: "rejected" };
  const money = await readFile(join(repo, "scripts/fixtures/JanitorMoneyProbe.java"), "utf8");
  assert.equal(sha256Hex(money), probe.frozen_input.money_driver_sha256);
  const moneyExpected = Object.fromEntries(
    Object.entries(probe.frozen_input.expected).filter(
      ([key]) => !task.contract.observation.cases.includes(key),
    ),
  );
  const reference = referenceVerifier(baseline, money, moneyExpected);
  const binaryFiles = {};
  for (const [name, digest] of Object.entries(task.environment.binaries)) {
    const bytes = await stableBytes(join(oldRoot, "control/dependencies", name));
    assert.equal(sha256Hex(bytes), digest);
    binaryFiles[`lib/${name}`] = bytes;
    await put(join(root, "control/dependencies", name), bytes);
  }
  const taskText = await readFile(join(assets, "TASK.md"));
  const common = {
    ...Object.fromEntries(
      Object.entries(domainFiles).filter(([name]) => name.startsWith("sources/")),
    ),
    ...binaryFiles,
    "TASK.md": taskText,
    "resources/mockito-extensions/org.mockito.plugins.MockMaker":
      Buffer.from("mock-maker-subclass\n"),
    [targetPath]: Buffer.from(samples.upstream_reference.source),
    LICENSE: await stableBytes(join(oldRoot, "workspace/LICENSE")),
    "ENVIRONMENT.json": Buffer.from(
      `${canonicalJson({
        java_home: task.environment.java_home,
        build_target: 11,
        editable_source: verifierPath,
        information_log: "INFORMATION.md",
        missing_information_log: "incomplete_delivery_not_code_failure",
        build_command: `${task.environment.java_home}/bin/javac -proc:none --release 11 -classpath 'lib/*' -d build src/*.java`,
        run_command: `${task.environment.java_home}/bin/java -Xmx256m -XX:-UsePerfData -classpath 'build:resources:lib/*' org.killbill.billing.payment.core.janitor.JanitorProbe build`,
        acceptance:
          "normal return accepts; AssertionError rejects; other failures invalidate the observation",
      })}\n`,
    ),
  };
  const arms = {};
  for (const name of ["raw_sources", "prior_knowledge"]) {
    const workspace = await mkdtemp(join(root, "workspace."));
    const files = {
      ...common,
      ...(name === "prior_knowledge"
        ? Object.fromEntries(
            Object.entries(domainFiles).filter(([path]) => !path.startsWith("sources/")),
          )
        : {}),
    };
    for (const [path, bytes] of Object.entries(files)) await put(join(workspace, path), bytes);
    await put(join(workspace, verifierPath), baseline);
    await mkdir(join(workspace, "build"));
    arms[name] = {
      workspace,
      protected_files: Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [path, sha256Hex(bytes)]),
      ),
    };
  }
  for (const path of Object.keys(common))
    assert.equal(
      arms.raw_sources.protected_files[path],
      arms.prior_knowledge.protected_files[path],
    );
  const treatmentFiles = Object.keys(arms.prior_knowledge.protected_files).filter(
    (p) => !(p in arms.raw_sources.protected_files),
  );
  assert.equal(treatmentFiles.length, 6);
  const body = {
    format: "janitor-knowledge-trial-v2",
    root,
    arms,
    baseline_source: baseline,
    samples,
    reference_verifier: reference,
    wrapper,
    environment: task.environment,
    common_files: Object.fromEntries(Object.entries(common).map(([p, b]) => [p, sha256Hex(b)])),
    treatment_files: treatmentFiles,
    knowledge_prior_revision: priorRevision,
    module_digest: lock.module_digest,
    author_probe_digest: probeEnvelope.digest,
    implementation_sha256: await implementationPin(),
    claim_scope: "prior_knowledge_package_consumption_only_not_serialization",
    independent_calibration: "pending",
    launch_ready: false,
    models_run: 0,
    qualification: "not_qualified",
  };
  const trial = envelope(body);
  await putJson(join(root, "control/trial.json"), trial);
  return {
    root,
    digest: trial.digest,
    arms: Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, v.workspace])),
    treatment_files: treatmentFiles,
    launch_ready: false,
    qualification: "not_qualified",
  };
}

async function loadTrial(root) {
  root = await insideRuntime(root);
  const value = await json(join(root, "control/trial.json")),
    task = checked(value);
  assert.equal(task.format, "janitor-knowledge-trial-v2");
  assert.equal(task.root, root);
  assert.equal(
    task.implementation_sha256,
    await implementationPin(),
    "use the pinned evaluator implementation",
  );
  return { ...task, digest: value.digest };
}
async function inspectWorkspace(arm) {
  await insideRuntime(arm.workspace);
  async function walk(path, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      assert.equal(entry.isSymbolicLink(), false, "symlink in submitted workspace");
      if (entry.isDirectory()) {
        await walk(join(path, entry.name), `${name}/`);
        continue;
      }
      assert.ok(entry.isFile(), "non-file workspace entry");
      assert.ok(
        name.startsWith("build/") ||
          name === verifierPath ||
          name === "INFORMATION.md" ||
          name in arm.protected_files,
        `unexpected file: ${name}`,
      );
    }
  }
  await walk(arm.workspace);
  for (const [path, digest] of Object.entries(arm.protected_files))
    assert.equal(
      sha256Hex(await stableBytes(join(arm.workspace, path))),
      digest,
      `protected input changed: ${path}`,
    );
}
export async function submitVerifier(root, armName) {
  const task = await loadTrial(root),
    arm = task.arms[armName];
  assert.ok(arm, "unknown arm");
  await inspectWorkspace(arm);
  const sourceBytes = await stableBytes(join(arm.workspace, verifierPath), 256 * 1024);
  const source = sourceBytes.toString("utf8");
  assert.ok(Buffer.from(source, "utf8").equals(sourceBytes), "verifier source must be valid UTF-8");
  let information = null;
  try {
    information = (await stableBytes(join(arm.workspace, "INFORMATION.md"), 128 * 1024)).toString(
      "utf8",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const submission = envelope({
    format: "janitor-verifier-submission-v1",
    task_digest: task.digest,
    arm: armName,
    source,
    source_sha256: sha256Hex(source),
    information,
    authorship: "unattested",
    qualification: "not_qualified",
  });
  await putJson(join(root, "control/submissions", `${submission.digest}.json`), submission);
  return { digest: submission.digest, information_present: Boolean(information?.trim()) };
}

async function assessSource(task, source) {
  assert.deepEqual(await fingerprintJdk(task.environment.java_home), task.environment.fingerprint);
  const evalRoot = await mkdtemp(join(task.root, "evaluation."));
  const jdk = task.environment.java_home;
  const jars = [];
  // Trusted copies outside either editable workspace. No model-supplied builds are executed.
  for (const [name, digest] of Object.entries(task.environment.binaries)) {
    const bytes = await stableBytes(join(task.root, "control/dependencies", name));
    assert.equal(sha256Hex(bytes), digest);
    const target = join(evalRoot, "trusted-deps", name);
    await put(target, bytes);
    jars.push(target);
  }
  const rows = [];
  for (const [id, sample] of Object.entries(task.samples)) {
    const unit = await mkdtemp(join(evalRoot, "unit.")),
      runRoot = join(unit, "run"),
      classes = join(runRoot, "classes");
    await put(join(unit, "JanitorProbe.java"), source);
    await put(join(unit, "IncompletePaymentTransactionTask.java"), sample.source);
    await put(join(unit, "WeaveVerifierMain.java"), task.wrapper);
    await put(
      join(classes, "mockito-extensions/org.mockito.plugins.MockMaker"),
      "mock-maker-subclass\n",
    );
    const runner = new StrictProcessRunner();
    const common = { readableRoots: [...jars, jdk], timeoutMs: 15000, maxOutputBytes: 256 * 1024 };
    const compile = await runner.run({
      ...common,
      cwd: unit,
      writableRoot: classes,
      executable: join(jdk, "bin/javac"),
      args: [
        "-proc:none",
        "--release",
        "11",
        "-classpath",
        jars.join(delimiter),
        "-d",
        classes,
        ...[
          "JanitorProbe.java",
          "IncompletePaymentTransactionTask.java",
          "WeaveVerifierMain.java",
        ].map((p) => join(unit, p)),
      ],
    });
    const execution =
      compile.exitCode === 0 && !compile.timedOut && !compile.outputLimitExceeded
        ? await runner.run({
            ...common,
            cwd: runRoot,
            writableRoot: join(runRoot, "scratch"),
            executable: join(jdk, "bin/java"),
            args: [
              "-Xmx256m",
              "-XX:-UsePerfData",
              "-classpath",
              [classes, ...jars].join(delimiter),
              "WeaveVerifierMain",
              classes,
            ],
          })
        : null;
    const row = {
      id,
      expected: sample.expected,
      observed: parseVerifierProcess(execution),
      compile,
      execution,
    };
    rows.push(row);
    await putJson(join(unit, "evidence.json"), row);
    if (row.observed === "invalid") break;
  }
  const result = classifyVerifierMatrix(rows);
  if (rows.length !== Object.keys(task.samples).length) {
    result.measurement_validity = "invalid";
    result.fits_selected_samples = false;
  }
  return { evalRoot, rows, result };
}
export async function evaluateVerifier(root, digest) {
  assert.match(digest, /^[0-9a-f]{64}$/);
  const task = await loadTrial(root),
    candidateEnvelope = await json(join(root, "control/submissions", `${digest}.json`));
  const candidate = checked(candidateEnvelope);
  assert.equal(candidate.format, "janitor-verifier-submission-v1");
  assert.ok(Object.hasOwn(task.arms, candidate.arm), "submission arm is not part of this trial");
  assert.equal(candidateEnvelope.digest, digest);
  assert.equal(candidate.task_digest, task.digest);
  assert.equal(sha256Hex(candidate.source), candidate.source_sha256);
  const evidence = await assessSource(task, candidate.source);
  const run = envelope({
    format: "janitor-verifier-run-v1",
    task_digest: task.digest,
    task,
    candidate_digest: digest,
    implementation_sha256: task.implementation_sha256,
    candidate: candidateEnvelope,
    evidence,
    qualification: "not_qualified",
    claim_scope: "selected_verifier_behavior_samples_only",
  });
  const path = join(root, "control/runs", `${run.digest}.json`);
  await putJson(path, run);
  return {
    path,
    digest: run.digest,
    result: evidence.result,
    artifact_delivery: {
      source_present: true,
      information_present: Boolean(candidate.information?.trim()),
      required_scope_review: "pending",
    },
    qualification: "not_qualified",
  };
}
export async function replayVerifier(path) {
  await insideRuntime(path);
  const run = checked(await json(path));
  assert.equal(run.format, "janitor-verifier-run-v1");
  assert.equal(run.implementation_sha256, await implementationPin());
  const task = checked(run.task);
  assert.equal(run.task.digest, run.task_digest);
  const candidate = checked(run.candidate);
  assert.equal(candidate.format, "janitor-verifier-submission-v1");
  assert.ok(Object.hasOwn(task.arms, candidate.arm));
  assert.equal(run.candidate_digest, run.candidate.digest);
  assert.equal(candidate.task_digest, run.task_digest);
  assert.equal(sha256Hex(candidate.source), candidate.source_sha256);
  const rows = run.evidence.rows.map((r) => ({
    ...r,
    observed: parseVerifierProcess(r.execution),
  }));
  assert.deepEqual(rows, run.evidence.rows);
  const order = Object.keys(task.samples);
  assert.deepEqual(
    rows.map((r) => r.id),
    order.slice(0, rows.length),
  );
  for (const row of rows) assert.equal(row.expected, task.samples[row.id].expected);
  const result = classifyVerifierMatrix(rows);
  if (rows.length !== order.length) {
    result.measurement_validity = "invalid";
    result.fits_selected_samples = false;
  }
  assert.deepEqual(result, run.evidence.result);
  return result;
}
export async function calibrateVerifier(root) {
  const task = await loadTrial(root);
  const skeleton = (body) =>
    `package org.killbill.billing.payment.core.janitor; public class JanitorProbe { public static void main(String[] args) throws Exception { ${body} } }`;
  const sourceDir = await mkdtemp(join(task.root, "calibration."));
  // Retain a separate security-check workspace; never modify either future model arm.
  const admissionDir = await mkdtemp(join(task.root, "admission-check."));
  await put(join(admissionDir, "TASK.md"), "protected input\n");
  await put(join(admissionDir, verifierPath), skeleton(""));
  const admission = {
    workspace: admissionDir,
    protected_files: { "TASK.md": sha256Hex("protected input\n") },
  };
  await inspectWorkspace(admission);
  await writeFile(join(admissionDir, "TASK.md"), "changed input\n");
  await assert.rejects(inspectWorkspace(admission), /protected input changed/);
  await writeFile(join(admissionDir, "TASK.md"), "protected input\n");
  await symlink(join(task.root, "control/trial.json"), join(admissionDir, "alias.java"));
  await assert.rejects(inspectWorkspace(admission), /symlink/);
  const isolationSource = skeleton(`
    try { java.nio.file.Files.readString(java.nio.file.Path.of(${JSON.stringify(join(task.root, "control/trial.json"))}));
      throw new AssertionError("private read succeeded"); } catch (java.nio.file.FileSystemException expected) {
        if (!(expected instanceof java.nio.file.AccessDeniedException) && !"Operation not permitted".equals(expected.getReason())) throw expected;
      }
    try { java.nio.file.Files.writeString(java.nio.file.Path.of(${JSON.stringify(join(task.root, "control/forbidden-write.txt"))}), "x");
      throw new AssertionError("private write succeeded"); } catch (java.nio.file.FileSystemException expected) {
        if (!(expected instanceof java.nio.file.AccessDeniedException) && !"Operation not permitted".equals(expected.getReason())) throw expected;
      }
  `);
  const isolation = await assessSource(
    { ...task, samples: { upstream_reference: task.samples.upstream_reference } },
    isolationSource,
  );
  const isolationPassed = isolation.rows.length === 1 && isolation.rows[0].observed === "accepted";
  await putJson(join(sourceDir, "isolation.json"), isolation);
  const samples = {
    reference_tests: { source: task.reference_verifier, expectedFit: true },
    old_checks_only: { source: task.baseline_source, expectedFit: false },
    money_checks_only: {
      source: task.reference_verifier.replace(
        "legacyMain(args);",
        "/* deliberately omit legacy checks */",
      ),
      expectedFit: false,
    },
    always_accept: { source: skeleton(""), expectedFit: false },
    always_reject: {
      source: skeleton('throw new AssertionError("reject all");'),
      expectedFit: false,
    },
  };
  const results = [];
  for (const [name, sample] of isolationPassed ? Object.entries(samples) : []) {
    await put(join(sourceDir, `${name}.java.txt`), sample.source);
    let evidence,
      admissionRun = null;
    if (name === "old_checks_only") {
      const submission = await submitVerifier(root, "raw_sources");
      const evaluated = await evaluateVerifier(root, submission.digest);
      const stored = checked(await json(evaluated.path));
      assert.equal(stored.candidate.source, sample.source);
      evidence = stored.evidence;
      assert.deepEqual(await replayVerifier(evaluated.path), evidence.result);
      admissionRun = { submission: submission.digest, run: evaluated.path };
    } else evidence = await assessSource(task, sample.source);
    results.push({
      name,
      expectedFit: sample.expectedFit,
      source_sha256: sha256Hex(sample.source),
      admission_run: admissionRun,
      old_four_sample_projection:
        name === "money_checks_only"
          ? classifyVerifierMatrix(
              evidence.rows.filter((r) => r.id !== "stale_snapshot_regression"),
            )
          : null,
      ...evidence,
    });
    if (
      evidence.result.measurement_validity !== "valid" ||
      evidence.result.fits_selected_samples !== sample.expectedFit
    )
      break;
  }
  const report = envelope({
    format: "janitor-verifier-calibration-v1",
    task_digest: task.digest,
    admission: {
      accepted_clean: true,
      rejected_protected_change: true,
      rejected_symlink: true,
      retained_root: admissionDir,
    },
    private_read_write_denied: isolationPassed,
    isolation,
    results,
    passed:
      isolationPassed &&
      results.length === Object.keys(samples).length &&
      results.every(
        (r) =>
          r.result.measurement_validity === "valid" &&
          r.result.fits_selected_samples === r.expectedFit,
      ) &&
      results.find((r) => r.name === "money_checks_only")?.old_four_sample_projection
        ?.fits_selected_samples === true,
    independent_review: "pending",
    models_run: 0,
    qualification: "not_qualified",
  });
  await putJson(join(sourceDir, "report.json"), report);
  return {
    path: join(sourceDir, "report.json"),
    digest: report.digest,
    passed: report.passed,
    results: results.map((r) => ({ name: r.name, ...r.result })),
    models_run: 0,
  };
}
