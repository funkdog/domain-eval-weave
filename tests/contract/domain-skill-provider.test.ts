import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

import applyDomainSkill, { loadBundledDomainSkill } from "../../src/domain/skill-provider.js";
import { DEDICATED_DSH_HOME } from "../../src/runtime-root.js";

test("bundled domain Skill strips frontmatter and preserves a directory resource base", async () => {
  const skill = await loadBundledDomainSkill();
  assert.equal(skill.name, "design-domain-grader");
  assert.match(skill.description, /domain onboarding/i);
  assert.doesNotMatch(skill.content, /^---/);
  assert.match(skill.content, /Classify before promotion/);
  assert.equal(skill.source, "bundled");
  assert.equal(skill.resourceBase.kind, "directory");
  assert.match(skill.resourceBase.path, /skills\/design-domain-grader$/);
});

test("domain Skill registers only in the exact author profile", async () => {
  let registration: unknown;
  let disposed = false;
  let stop: (() => void) | undefined;
  const context = {
    root: {
      baseUrl: pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-clowder-author/`).href,
    },
    skills: {
      register: (skill: unknown) => {
        registration = skill;
        return () => {
          disposed = true;
        };
      },
    },
    effect: (callback: () => () => void) => {
      const dispose = callback();
      stop = () => dispose();
      return stop;
    },
  };
  await applyDomainSkill(context, {
    env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
  });
  assert.equal((registration as { name: string }).name, "design-domain-grader");
  stop?.();
  assert.equal(disposed, true);

  await assert.rejects(
    applyDomainSkill(
      {
        ...context,
        root: {
          baseUrl: pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-clowder-runner/`).href,
        },
      },
      { env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" } },
    ),
  );
});
