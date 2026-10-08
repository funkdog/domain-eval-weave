import assert from "node:assert/strict";
import test from "node:test";
import { renderDomainProse, verifyDomainProse } from "../lib/domain-prose-material.mjs";

test("document rendering retains relationships, types, empty values and unknown fields", () => {
  const model = {
    module_id: "example",
    concepts: [{ concept_id: "Payment", definition: "state ≠ money; [source]\nsecond line" }],
    relations: [{ subject_ref: "Payment", predicate: "contains", object_ref: "Transaction" }],
    extension: { enabled: false, amount: 0, absent: null, empty: [], other: {} },
  };
  const rendered = renderDomainProse(model);
  assert.equal(verifyDomainProse(model, rendered), true);
  assert.match(rendered.markdown, /Payment/);
  assert.match(rendered.markdown, /contains/);
  assert.ok(rendered.inventory.some((n) => n.pointer === "/extension/amount" && n.value === 0));
  assert.ok(rendered.inventory.some((n) => n.pointer === "/extension/absent" && n.kind === "null"));
  assert.ok(rendered.inventory.some((n) => n.pointer === "/extension/empty" && n.kind === "array"));
});

test("missing knowledge or edited prose is rejected rather than called equivalent", () => {
  const model = {
    claims: [{ claim_id: "C1", statement: "same state does not update", unknown: true }],
  };
  const rendered = renderDomainProse(model);
  assert.throws(() =>
    verifyDomainProse(model, { ...rendered, inventory: rendered.inventory.slice(1) }),
  );
  assert.throws(() =>
    verifyDomainProse(model, {
      ...rendered,
      markdown: rendered.markdown.replace("does not", "does"),
    }),
  );
});

test("nested containers never absorb sibling scalars or lose deep hierarchy", () => {
  const value = {
    claim: { valid_time: { from: "2026-01-01" }, recorded_at: "2026-02-01" },
    a: { b: { c: { d: { e: { f: { child: 1 }, sibling: 2 } } } } },
  };
  const r = renderDomainProse(value);
  const indent = (pointer) => {
    const span = r.spans.find((s) => s.pointer === pointer);
    const line = r.markdown.slice(span.start, span.end).split("\n")[0];
    assert.match(line, /^ *- /);
    return line.match(/^ */)[0].length;
  };
  assert.equal(indent("/claim/valid_time"), indent("/claim/recorded_at"));
  assert.equal(indent("/claim/valid_time/from"), indent("/claim/valid_time") + 4);
  assert.equal(indent("/a/b/c/d/e/f/child"), indent("/a/b/c/d/e/sibling") + 4);
});
