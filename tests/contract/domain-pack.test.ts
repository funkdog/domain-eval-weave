import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson, canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
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
    const { manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const pack = await validateDomainPack(project, "domain-eval", manifestRef, {
      confirmationLedger,
    });
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
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifest = JSON.parse(await readFile(`${packRoot}/${manifestRef}`, "utf8")) as {
      graph: { ref: string };
    };
    const graphPath = `${packRoot}/${manifest.graph.ref}`;
    const graph = JSON.parse(await readFile(graphPath, "utf8")) as Record<string, unknown>;
    graph.reverse_index = {};
    await writeFile(graphPath, `${canonicalJson(graph)}\n`, "utf8");
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );

    await writeSyntheticDomainPack(project);
    const interviewPath = `${packRoot}/interviews/commerce-onboard-v1/r1.json`;
    const interview = JSON.parse(await readFile(interviewPath, "utf8")) as {
      turns: Array<{ answer: string }>;
    };
    const firstTurn = interview.turns[0];
    assert.ok(firstTurn);
    firstTurn.answer = "A mutated policy answer.";
    await writeFile(interviewPath, `${canonicalJson(interview)}\n`, "utf8");
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack rejects a dangling Interview evidence-card pointer", async () => {
  const project = await scratchProject("domain-pack-interview-card");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifestPath = `${packRoot}/${manifestRef}`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      interviews: Array<{ ref: string; sha256: string }>;
    };
    const interviewPointer = manifest.interviews[0];
    assert.ok(interviewPointer);
    const interviewPath = `${packRoot}/${interviewPointer.ref}`;
    const interview = JSON.parse(await readFile(interviewPath, "utf8")) as {
      evidence_card_refs: Array<{ ref: string; sha256: string }>;
    };
    interview.evidence_card_refs = [
      { ref: "evidence-cards/missing/r1.json", sha256: "a".repeat(64) },
    ];
    await writeFile(interviewPath, `${canonicalJson(interview)}\n`, { mode: 0o600 });
    interviewPointer.sha256 = canonicalJsonDigest(interview);
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain pack replays contiguous predecessor revisions instead of trusting only current bytes", async () => {
  const project = await scratchProject("domain-pack-predecessor");
  try {
    const { packRoot, manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    const manifestPath = `${packRoot}/${manifestRef}`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      interviews: Array<{ ref: string; sha256: string }>;
    };
    const currentPointer = manifest.interviews[0];
    assert.ok(currentPointer);
    const revisionOne = JSON.parse(
      await readFile(`${packRoot}/${currentPointer.ref}`, "utf8"),
    ) as Record<string, unknown>;
    const revisionTwo = {
      ...revisionOne,
      revision: 2,
      predecessor: {
        ref: currentPointer.ref,
        sha256: canonicalJsonDigest(revisionOne),
      },
    };
    const revisionTwoRef = "interviews/commerce-onboard-v1/r2.json";
    await writeFile(`${packRoot}/${revisionTwoRef}`, `${canonicalJson(revisionTwo)}\n`, {
      mode: 0o600,
    });
    manifest.interviews = [{ ref: revisionTwoRef, sha256: canonicalJsonDigest(revisionTwo) }];
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
    await assert.doesNotReject(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
    );

    (revisionTwo.predecessor as { sha256: string }).sha256 = "f".repeat(64);
    await writeFile(`${packRoot}/${revisionTwoRef}`, `${canonicalJson(revisionTwo)}\n`, {
      mode: 0o600,
    });
    manifest.interviews = [{ ref: revisionTwoRef, sha256: canonicalJsonDigest(revisionTwo) }];
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
    await assert.rejects(
      validateDomainPack(project, "domain-eval", manifestRef, { confirmationLedger }),
      DomainPackError,
    );
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
