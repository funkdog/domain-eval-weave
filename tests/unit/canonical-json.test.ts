import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../src/contracts/canonical-json.js";

test("canonical JSON recursively sorts object keys and preserves array order", () => {
  const first = {
    z: [{ y: 2, x: 1 }, 3],
    a: { d: false, c: null },
  };
  const second = {
    a: { c: null, d: false },
    z: [{ x: 1, y: 2 }, 3],
  };

  const expected = '{"a":{"c":null,"d":false},"z":[{"x":1,"y":2},3]}';
  assert.equal(canonicalJson(first), expected);
  assert.equal(canonicalJson(second), expected);
  assert.equal(canonicalJsonDigest(first), canonicalJsonDigest(second));
});

test("canonical JSON rejects values outside the JSON data model", () => {
  assert.throws(() => canonicalJson({ missing: undefined }));
  assert.throws(() => canonicalJson({ value: Number.NaN }));
  assert.throws(() => canonicalJson({ value: Number.NEGATIVE_INFINITY }));
  assert.throws(() => canonicalJson(new Date("2026-08-17T00:00:00.000Z")));
  assert.throws(() => canonicalJson(new Array(1)));
  assert.throws(() =>
    canonicalJson(
      Object.defineProperty({}, "dynamic", {
        enumerable: true,
        get: () => "value",
      }),
    ),
  );
});

test("SHA-256 operates on exact UTF-8 bytes", () => {
  assert.equal(
    sha256Hex("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});
