import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";

export const consumerTools = [
  {
    name: "read_guide",
    description:
      "Read the delivered consumer kit README. This is the consumer's usage guide, not a coding task answer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "kit_command",
    description:
      "Run the kit's CLI in its trusted control plane. Pass arguments after 'node cli.mjs' exactly as described in the README. Only doctor, prepare, submit, evaluate and replay are supported; no shell or code repair.",
    inputSchema: {
      type: "object",
      properties: { args: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 } },
      required: ["args"],
      additionalProperties: false,
    },
  },
];

export async function createConsumerBroker({ kitRoot, logRoot, kitDigest }) {
  const runtime = await realpath("/Users/slipshod/AIBuild/dsh-eval-lab-runtime");
  for (const path of [kitRoot, logRoot]) {
    assert.equal(await realpath(path), resolve(path));
    const rel = relative(runtime, path);
    assert.ok(rel && !rel.startsWith("..") && !rel.startsWith("/"));
  }
  assert.ok(
    !relative(kitRoot, logRoot).startsWith("state/"),
    "logs must be outside consumer state",
  );
  const manifestBytes = await readFile(join(kitRoot, "kit.json"));
  assert.equal(sha256Hex(manifestBytes), kitDigest);
  const manifest = JSON.parse(manifestBytes);
  for (const [name, pin] of Object.entries(manifest.files)) {
    assert.ok(name.split("/").every((p) => p && p !== "." && p !== ".."));
    const path = join(kitRoot, name);
    assert.equal(await realpath(path), path);
    const stat = await lstat(path);
    assert.ok(stat.isFile() && stat.nlink === 1);
    assert.equal(sha256Hex(await readFile(path)), pin.sha256);
  }
  const guide = await readFile(join(kitRoot, "README.md"), "utf8");
  const instances = new Set(),
    submissions = new Set(),
    runs = new Set();
  let sequence = 0,
    previous = null,
    prepared = false,
    evaluated = false;
  async function record(body) {
    const value = { seq: ++sequence, previous, ...body };
    const digest = canonicalJsonDigest(value);
    previous = digest;
    await writeExclusiveOrVerify(
      join(logRoot, `${String(sequence).padStart(4, "0")}.json`),
      Buffer.from(`${canonicalJson({ ...value, digest })}\n`),
      () => new Error("broker log collision"),
    );
  }
  async function invoke(name, args) {
    assert.ok(sequence < 64, "consumer tool budget exhausted");
    await record({ phase: "started", tool: name, arguments: args });
    try {
      let output;
      if (name === "read_guide") {
        assert.deepEqual(args, {});
        output = { content: [{ type: "text", text: guide }], isError: false };
      } else {
        assert.equal(name, "kit_command", "unsupported tool");
        assert.deepEqual(Object.keys(args), ["args"]);
        const argv = args.args;
        assert.ok(
          Array.isArray(argv) && argv.every((x) => typeof x === "string" && x.length < 4096),
        );
        const counts = { doctor: 1, prepare: 1, submit: 2, evaluate: 3, replay: 2 };
        const verb = argv[0];
        assert.equal(argv.length, counts[verb], "unsupported command or argument count");
        if (verb === "prepare") {
          assert.equal(prepared, false, "only one consumer instance is allowed");
          prepared = true;
        }
        if (["submit", "evaluate"].includes(verb))
          assert.ok(instances.has(argv[1]), "instance was not issued by this broker");
        if (verb === "evaluate") {
          assert.equal(evaluated, false, "only one baseline evaluation is allowed");
          assert.ok(
            submissions.has(`${argv[1]}:${argv[2]}`),
            "submission was not issued by this broker",
          );
          evaluated = true;
        }
        if (verb === "replay") assert.ok(runs.has(argv[1]), "run was not issued by this broker");
        const result = await promisify(execFile)(
          process.execPath,
          [join(kitRoot, "cli.mjs"), ...argv],
          {
            cwd: kitRoot,
            env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: "C", LC_ALL: "C" },
            timeout: 75000,
            maxBuffer: 512 * 1024,
            encoding: "utf8",
          },
        );
        const value = JSON.parse(result.stdout);
        if (verb === "prepare") {
          assert.ok(value.root.startsWith(`${kitRoot}/state/janitor-coding.`));
          instances.add(value.root);
        }
        if (verb === "submit") submissions.add(`${argv[1]}:${value.digest}`);
        if (verb === "evaluate") runs.add(value.path);
        output = {
          content: [
            {
              type: "text",
              text: JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: 0 }),
            },
          ],
          isError: false,
        };
      }
      await record({ phase: "finished", tool: name, result: output });
      return output;
    } catch (error) {
      const output = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: error.message,
              stdout: error.stdout ?? "",
              stderr: error.stderr ?? "",
            }),
          },
        ],
        isError: true,
      };
      await record({ phase: "finished", tool: name, result: output });
      return output;
    }
  }
  await mkdir(logRoot, { recursive: true });
  return { invoke };
}
