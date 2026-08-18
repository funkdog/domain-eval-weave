import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson } from "../../src/contracts/canonical-json.js";
import { impactedByClaim } from "../../src/domain/graph.js";
import { DomainPackError, validateDomainPack } from "../../src/domain/pack.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { writeSyntheticDomainPack } from "../helpers/domain-pack-fixture.js";

async function scratchProject(prefix: string): Promise<string> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(`${parent}/${prefix}-`);
}

test("domain pack validates source locators, primary digests, graph replay, and readiness", async () => {
  const project = await scratchProject("domain-pack-valid");
  try {
    const { manifestRef } = await writeSyntheticDomainPack(project);
    const pack = await validateDomainPack(project, "domain-eval", manifestRef);
    assert.equal(pack.readiness.overall, "green");
    assert.deepEqual(impactedByClaim(pack.graph, "refund-cash-limit"), {
      dependent_claim_ids: [],
      proposed_claim_ids: [],
      requirement_ids: ["order-cancellation-v1", "partial-refund-v1"],
    });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack rejects graph drift and owner-answer source drift", async () => {
  const project = await scratchProject("domain-pack-drift");
  try {
    const { packRoot, manifestRef } = await writeSyntheticDomainPack(project);
    const manifest = JSON.parse(await readFile(`${packRoot}/${manifestRef}`, "utf8")) as {
      graph: { ref: string };
    };
    const graphPath = `${packRoot}/${manifest.graph.ref}`;
    const graph = JSON.parse(await readFile(graphPath, "utf8")) as Record<string, unknown>;
    graph.reverse_index = {};
    await writeFile(graphPath, `${canonicalJson(graph)}\n`, "utf8");
    await assert.rejects(validateDomainPack(project, "domain-eval", manifestRef), DomainPackError);

    await writeSyntheticDomainPack(project);
    const interviewPath = `${packRoot}/interviews/commerce-onboard-v1/r1.json`;
    const interview = JSON.parse(await readFile(interviewPath, "utf8")) as {
      turns: Array<{ answer: string }>;
    };
    const firstTurn = interview.turns[0];
    assert.ok(firstTurn);
    firstTurn.answer = "A mutated policy answer.";
    await writeFile(interviewPath, `${canonicalJson(interview)}\n`, "utf8");
    await assert.rejects(validateDomainPack(project, "domain-eval", manifestRef), DomainPackError);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack path rejects traversal, absolute paths, and symlink roots", async () => {
  const project = await scratchProject("domain-pack-path");
  const outside = await scratchProject("domain-pack-outside");
  try {
    await writeSyntheticDomainPack(outside);
    await symlink(`${outside}/domain-eval`, `${project}/linked-pack`);
    for (const ref of ["../outside/domain-eval", `${outside}/domain-eval`, "linked-pack"]) {
      await assert.rejects(
        validateDomainPack(project, ref, "manifests/snapshot-synthetic-commerce-v1.json"),
        DomainPackError,
      );
    }
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
