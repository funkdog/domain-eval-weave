import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { stringify } from "yaml";

import { parseCapsuleDomain, parseCapsuleManifest } from "./contracts.js";
import { CapsuleError, loadCapsule } from "./loader.js";

async function writeExclusive(path: string, contents: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
  } finally {
    await handle.close();
  }
}

export async function initializeCapsule(input: {
  readonly root: string;
  readonly capsuleId: string;
  readonly domainId: string;
  readonly ownerId: string;
}) {
  const manifest = parseCapsuleManifest({
    schema_version: 1,
    capsule_id: input.capsuleId,
    version: "0.1.0",
    title: input.capsuleId,
    domain: "domain.yaml",
    sources: [],
    requirements: [],
    evaluators: [],
    candidates: [],
    cases: [],
  });
  const domain = parseCapsuleDomain({
    schema_version: 1,
    domain_id: input.domainId,
    version: "0.1.0",
    owners: [{ owner_id: input.ownerId, display_name: input.ownerId }],
    claims: [],
  });
  const root = resolve(input.root);
  const existing = await lstat(root).catch(() => undefined);
  if (existing !== undefined) {
    throw new CapsuleError(
      "CAPSULE_INIT_TARGET_EXISTS",
      "Capsule target already exists; init never overwrites a non-empty path",
      root,
    );
  }
  const parent = dirname(root);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(parent, `.${basename(root)}.init-`));
  try {
    await Promise.all(
      ["sources", "requirements", "evaluators", "candidates", "cases"].map((name) =>
        mkdir(resolve(staging, name), { mode: 0o700 }),
      ),
    );
    await Promise.all([
      writeExclusive(resolve(staging, "capsule.yaml"), stringify(manifest, { lineWidth: 0 })),
      writeExclusive(resolve(staging, "domain.yaml"), stringify(domain, { lineWidth: 0 })),
      writeExclusive(resolve(staging, ".gitignore"), ".eval/\n"),
      writeExclusive(
        resolve(staging, "README.md"),
        `# ${input.capsuleId}\n\nThis Capsule is a truth-empty draft. Add sources and proposed Claims before creating hard evaluation checks.\n`,
      ),
    ]);
    await rename(staging, root);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return loadCapsule(root);
}
