import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createConsumerBroker } from "../lib/janitor-consumer-broker.mjs";

test("consumer broker rejects shell and foreign artifacts, then runs one unchanged baseline through the real kit", async () => {
  const original = process.env.JANITOR_CONSUMER_KIT;
  assert.ok(original);
  const root = await mkdtemp("/Users/slipshod/AIBuild/dsh-eval-lab-runtime/consumer-broker-test.");
  const kit = join(root, "kit"),
    logs = join(root, "logs");
  await cp(original, kit, { recursive: true });
  await mkdir(logs);
  const broker = await createConsumerBroker({
    kitRoot: kit,
    logRoot: logs,
    kitDigest: (await readFile(join(kit, "kit.sha256"), "utf8")).trim(),
  });
  assert.equal(
    (await broker.invoke("kit_command", { args: ["workspace-exec", root, "pwd"] })).isError,
    true,
  );
  assert.equal(
    (await broker.invoke("kit_command", { args: ["replay", join(original, "kit.json")] })).isError,
    true,
  );
  assert.equal((await broker.invoke("read_guide", {})).isError, false);
  const call = async (args) => {
    const r = await broker.invoke("kit_command", { args });
    assert.equal(r.isError, false, r.content[0].text);
    return JSON.parse(JSON.parse(r.content[0].text).stdout);
  };
  assert.equal((await call(["doctor"])).ready, true);
  const instance = await call(["prepare"]);
  const source = await call(["submit", instance.root]);
  const run = await call(["evaluate", instance.root, source.digest]);
  assert.equal(run.result.measurement_validity, "valid");
  assert.equal(run.result.verdict, "fail");
  assert.deepEqual(await call(["replay", run.path]), run.result);
  assert.equal(
    (await broker.invoke("kit_command", { args: ["evaluate", instance.root, source.digest] }))
      .isError,
    true,
  );
  console.log(JSON.stringify({ root, run_digest: run.digest }));
});
