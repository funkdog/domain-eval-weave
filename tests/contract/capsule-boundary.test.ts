import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const publicRoots = ["capsule", "evaluator", "harness"] as const;

test("Capsule thin waist has no DSH, Judge, auth or domain-template dependency", async () => {
  for (const directory of publicRoots) {
    const root = new URL(`../../packages/weave/src/${directory}/`, import.meta.url);
    for (const name of await readdir(root)) {
      if (!name.endsWith(".ts")) continue;
      const source = await readFile(new URL(name, root), "utf8");
      assert.doesNotMatch(
        source,
        /from ["'][^"']*(?:@deepseek-ai|\/(?:phase3c|commerce|auth|runtime-profile|carrier)(?:\/|[.]))[^"']*["']/,
        `${directory}/${name}`,
      );
    }
  }
});
