import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

function argumentsMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || result.has(name)) {
      throw new Error("invalid args");
    }
    result.set(name, value);
  }
  return result;
}

const DRIVER_SOURCE = String.raw`
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
process.execArgv.splice(0, process.execArgv.length);
if ("_eval" in process) delete process._eval;
const candidate = process.argv[1];
let ReservationLedger;
try {
  ({ ReservationLedger } = await import(pathToFileURL(candidate + "/src/ledger.ts").href));
  if (typeof ReservationLedger?.open !== "function") throw new Error("invalid candidate API");
} catch {
  process.exit(1);
}
let ledger;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const active = new Set();
for await (const line of input) {
  const pending = (async () => {
    let request;
    try {
      request = JSON.parse(line);
      let value;
      switch (request.operation) {
        case "open":
          ledger = await ReservationLedger.open(request.file, request.capacity);
          value = true;
          break;
        case "reserve":
          value = await ledger.reserve(request.request);
          break;
        case "commit":
          value = await ledger.commit(request.requestId);
          break;
        case "release":
          value = await ledger.release(request.requestId);
          break;
        case "snapshot":
          value = await ledger.snapshot();
          break;
        default:
          throw new Error("unknown operation");
      }
      process.stdout.write(JSON.stringify({ id: request.id, ok: true, value }) + "\n");
    } catch {
      process.stdout.write(JSON.stringify({ id: request?.id, ok: false }) + "\n");
    }
  })();
  active.add(pending);
  void pending.finally(() => active.delete(pending));
}
await Promise.allSettled([...active]);
`;

class CandidateDriver {
  #child;
  #nextId = 0;
  #pending = new Map();
  #closed;

  constructor(candidate) {
    this.#child = spawn(
      process.execPath,
      ["--input-type=module", "-e", DRIVER_SOURCE, "--", candidate],
      { cwd: candidate, env: process.env, stdio: ["pipe", "pipe", "ignore"] },
    );
    this.#closed = new Promise((resolveClosed) => this.#child.once("close", resolveClosed));
    createInterface({ input: this.#child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        this.#fail(new Error("candidate driver protocol failed"));
        return;
      }
      const pending = this.#pending.get(response.id);
      if (pending === undefined) return;
      this.#pending.delete(response.id);
      if (response.ok === true) pending.resolve(response.value);
      else pending.reject(new Error("candidate operation failed"));
    });
    this.#child.once("error", (error) => this.#fail(error));
    this.#child.once("close", () => this.#fail(new Error("candidate driver exited")));
  }

  #fail(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  call(operation, fields = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolveCall, rejectCall) => {
      this.#pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.#child.stdin.write(`${JSON.stringify({ id, operation, ...fields })}\n`, (error) => {
        if (error) {
          this.#pending.delete(id);
          rejectCall(error);
        }
      });
    });
  }

  async close() {
    this.#child.stdin.end();
    const timer = setTimeout(() => this.#child.kill("SIGKILL"), 500);
    try {
      await this.#closed;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function withDriver(candidate, operation) {
  const driver = new CandidateDriver(candidate);
  try {
    return await operation(driver);
  } finally {
    await driver.close();
  }
}

async function rejects(operation) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

const args = argumentsMap(process.argv.slice(2));
process.execArgv.splice(0, process.execArgv.length);
if ("_eval" in process) delete process._eval;
const candidate = resolve(args.get("--candidate"));
const scratch = resolve(args.get("--scratch"));
const seed = Number(args.get("--seed"));
const opaque = (label) =>
  `r-${createHash("sha256").update(`${seed}:${label}`).digest("hex").slice(0, 16)}`;
let stateFile;

const checks = {
  async basic_reservation() {
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      const reservation = await driver.call("reserve", {
        request: { requestId: opaque("basic"), key: "alpha", units: 3 },
      });
      assert.equal(reservation.status, "pending");
      assert.equal((await driver.call("snapshot")).used, 3);
    });
  },
  async idempotent_replay() {
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      const request = { requestId: opaque("replay"), key: "alpha", units: 2 };
      assert.deepEqual(
        await driver.call("reserve", { request }),
        await driver.call("reserve", { request }),
      );
      assert.equal((await driver.call("snapshot")).reservations.length, 1);
    });
  },
  async conflicting_replay_rejected() {
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      const requestId = opaque("conflict");
      await driver.call("reserve", { request: { requestId, key: "alpha", units: 2 } });
      const before = await driver.call("snapshot");
      assert.equal(
        await rejects(() =>
          driver.call("reserve", { request: { requestId, key: "beta", units: 3 } }),
        ),
        true,
      );
      assert.deepEqual(await driver.call("snapshot"), before);
    });
  },
  async no_oversubscription_concurrent() {
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      const settled = await Promise.allSettled([
        driver.call("reserve", {
          request: { requestId: opaque("left"), key: "left", units: 6 },
        }),
        driver.call("reserve", {
          request: { requestId: opaque("right"), key: "right", units: 6 },
        }),
      ]);
      assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
      assert.ok((await driver.call("snapshot")).used <= 10);
    });
  },
  async terminal_transition_idempotency() {
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      const requestId = opaque("terminal");
      await driver.call("reserve", { request: { requestId, key: "alpha", units: 1 } });
      const first = await driver.call("commit", { requestId });
      assert.deepEqual(await driver.call("commit", { requestId }), first);
      assert.equal(await rejects(() => driver.call("release", { requestId })), true);
    });
  },
  async restart_recovery() {
    const requestId = opaque("restart");
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      await driver.call("reserve", { request: { requestId, key: "alpha", units: 4 } });
      await driver.call("commit", { requestId });
    });
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      const snapshot = await driver.call("snapshot");
      assert.equal(snapshot.used, 4);
      assert.equal(
        snapshot.reservations.find((entry) => entry.requestId === requestId)?.status,
        "committed",
      );
    });
  },
  async corrupt_state_fail_closed() {
    await writeFile(stateFile, "{not-json", "utf8");
    const before = await readFile(stateFile, "utf8");
    assert.equal(
      await rejects(() =>
        withDriver(candidate, (driver) => driver.call("open", { file: stateFile, capacity: 10 })),
      ),
      true,
    );
    assert.equal(await readFile(stateFile, "utf8"), before);
  },
  async deterministic_snapshot() {
    await withDriver(candidate, async (driver) => {
      await driver.call("open", { file: stateFile, capacity: 10 });
      const z = opaque("z");
      const a = opaque("a");
      await driver.call("reserve", { request: { requestId: z, key: "z", units: 1 } });
      await driver.call("reserve", { request: { requestId: a, key: "a", units: 1 } });
      const snapshot = await driver.call("snapshot");
      assert.deepEqual(
        snapshot.reservations.map((entry) => entry.requestId),
        [a, z].sort(),
      );
      assert.deepEqual(await driver.call("snapshot"), snapshot);
    });
  },
};

const behavior = {};
let index = 0;
for (const [name, operation] of Object.entries(checks)) {
  const behaviorScratch = resolve(scratch, `case-${index}`);
  index += 1;
  await mkdir(behaviorScratch, { recursive: true });
  stateFile = resolve(behaviorScratch, "ledger-state.json");
  try {
    await operation();
    behavior[name] = "pass";
  } catch {
    behavior[name] = "fail";
  }
}
process.stdout.write(JSON.stringify({ schema_version: 1, behavior }));
