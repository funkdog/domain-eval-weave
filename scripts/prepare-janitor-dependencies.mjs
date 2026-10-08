import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

// Explicit release coordinates from the pinned Kill Bill parent and Mockito POM.
// Downloads only; never installs software globally or starts an external service.
const coordinates = [
  ["org.kill-bill.billing", "killbill-payment", "0.24.21"],
  ["org.kill-bill.billing", "killbill-payment", "0.24.21", "sources"],
  ["org.kill-bill.billing", "killbill-internal-api", "0.24.21"],
  ["org.kill-bill.billing", "killbill-util", "0.24.21"],
  ["org.kill-bill.billing", "killbill-api", "0.54.0"],
  ["org.kill-bill.billing", "killbill-platform-api", "0.41.23"],
  ["org.kill-bill.billing", "killbill-platform-osgi-api", "0.41.23"],
  ["org.kill-bill.billing.plugin", "killbill-plugin-api-payment", "0.27.3"],
  ...[
    "automaton",
    "locker",
    "config-magic",
    "utils",
    "clock",
    "jdbi",
    "metrics-api",
    "xmlloader",
    "queue",
  ].map((name) => ["org.kill-bill.commons", `killbill-${name}`, "0.26.15"]),
  ["javax.inject", "javax.inject", "1"],
  ["com.google.code.findbugs", "jsr305", "3.0.2"],
  ["org.slf4j", "slf4j-api", "2.0.9"],
  ["joda-time", "joda-time", "2.12.5"],
  ["org.mockito", "mockito-core", "5.3.1"],
  ["net.bytebuddy", "byte-buddy", "1.14.5"],
  ["org.objenesis", "objenesis", "3.3"],
];
const root = await mkdtemp("/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-dependencies.");
console.log(JSON.stringify({ root }));
const reuseRoot = process.argv[2] ? await realpath(process.argv[2]) : null;
if (reuseRoot)
  assert.ok(!relative("/Users/slipshod/AIBuild/dsh-eval-lab-runtime", reuseRoot).startsWith(".."));
const reuse = reuseRoot
  ? JSON.parse(await readFile(join(reuseRoot, "dependencies.json"), "utf8"))
  : null;
const artifacts = [];
const locked = JSON.parse(
  await readFile(
    new URL(
      "../packages/weave/examples/killbill-janitor-recovery/dependency-lock.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
let total = 0;
for (const [group, artifact, version, classifier] of coordinates) {
  const filename = `${artifact}-${version}${classifier ? `-${classifier}` : ""}.jar`;
  const url = `https://repo.maven.apache.org/maven2/${group.replaceAll(".", "/")}/${artifact}/${version}/${filename}`;
  const cached = reuse?.artifacts.find((row) => row.url === url && row.filename === filename);
  let bytes, sha1;
  if (cached) {
    bytes = await readFile(join(reuseRoot, filename));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), cached.sha256);
    sha1 = cached.repository_sha1;
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, url);
    assert.ok(
      Number(response.headers.get("content-length")) < 16 * 1024 * 1024,
      "bounded artifact required",
    );
    bytes = Buffer.from(await response.arrayBuffer());
    const sha1Response = await fetch(`${url}.sha1`, { signal: AbortSignal.timeout(15000) });
    assert.equal(sha1Response.status, 200);
    sha1 = (await sha1Response.text()).trim().split(/\s+/)[0];
  }
  total += bytes.length;
  assert.ok(total < 32 * 1024 * 1024, "dependency scope exceeds this probe's bound");
  assert.equal(createHash("sha1").update(bytes).digest("hex"), sha1, filename);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    locked.artifacts.find((row) => row.filename === filename)?.sha256,
    "release bytes differ from the development lock",
  );
  await writeFile(join(root, filename), bytes, { flag: "wx", mode: 0o600 });
  artifacts.push({
    group,
    artifact,
    version,
    classifier: classifier ?? null,
    filename,
    url,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    repository_sha1: sha1,
  });
  await writeFile(
    join(root, `download-${artifacts.length}.json`),
    JSON.stringify(artifacts.at(-1), null, 2),
    { flag: "wx" },
  );
}
await writeFile(
  join(root, "dependencies.json"),
  JSON.stringify(
    {
      provenance: "explicit_release_coordinates_with_repository_sha1_and_local_sha256",
      total_bytes: total,
      artifacts,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(JSON.stringify({ root, artifacts: artifacts.length, bytes: total }));
