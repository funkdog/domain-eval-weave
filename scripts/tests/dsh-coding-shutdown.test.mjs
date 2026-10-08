import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Coding shutdown flushes evidence then exits despite a retained provider handle", () => {
  const result = run("async () => emit('flushed')", "async () => emit('disposed')");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /flushed\ndisposed\n.*"status":"disposed"/);
});

test("Coding shutdown records disposal timeout without turning it into Agent success", () => {
  const result = run("async () => emit('flushed')", "() => new Promise(() => {})");
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /"status":"dispose_timed_out"/);
});

test("Coding shutdown fails closed when evidence flush fails", () => {
  const result = run(
    "async () => { throw new Error('synthetic failure'); }",
    "async () => emit('disposed')",
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /"status":"flush_failed"/);
  assert.doesNotMatch(result.stdout, /disposed/);
});

function run(flush, dispose) {
  const url = new URL("../lib/dsh-coding-shutdown.mjs", import.meta.url).href;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { writeSync } from 'node:fs';
    import { finishCodingWorker } from ${JSON.stringify(url)};
    const emit = value => writeSync(1, value + '\\n');
    setInterval(() => {}, 1000);
    await finishCodingWorker({flush:${flush}, dispose:${dispose}, record:async value => emit(JSON.stringify(value)), exitCode:0, timeoutMs:25});
  `,
    ],
    { encoding: "utf8", timeout: 1000 },
  );
}
