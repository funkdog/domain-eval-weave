import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = resolve(repositoryRoot, "cleanroom/phase4b-contributor-v1");
const targetArg = process.argv[2];
if (targetArg === undefined) throw new Error("usage: materialize-phase4b-cleanroom <target>");
const target = resolve(targetArg);
if (await lstat(target).catch(() => undefined)) {
  throw new Error("clean-room target already exists");
}
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
const staging = await mkdtemp(join(dirname(target), `.${basename(target)}.stage-`));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collect(root, prefix) {
  const entries = [];
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = resolve(directory, item.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error("clean-room material cannot contain symlinks");
      if (item.isDirectory()) {
        await walk(path);
      } else if (item.isFile() && stat.nlink === 1) {
        const bytes = await readFile(path);
        entries.push({
          path: `${prefix}/${relative(root, path).split("\\").join("/")}`,
          sha256: sha256(bytes),
          size: bytes.byteLength,
        });
      } else {
        throw new Error("clean-room material contains an unsupported entry");
      }
    }
  }
  await walk(root);
  return entries;
}

async function writeExclusive(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(value);
  } finally {
    await handle.close();
  }
}

try {
  const inputs = resolve(staging, "inputs");
  const packageRoot = resolve(staging, "package");
  await mkdir(packageRoot, { mode: 0o700 });
  await cp(sourceRoot, inputs, { recursive: true, force: false, errorOnExist: true });
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined) {
    throw new Error("materialization must run under pnpm so the frozen package manager is known");
  }
  await execFileAsync(process.execPath, [pnpmCli, "pack", "--pack-destination", packageRoot], {
    cwd: resolve(repositoryRoot, "packages/lab"),
    maxBuffer: 32 * 1024 * 1024,
  });
  const archives = (await readdir(packageRoot)).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("Lab pack did not produce exactly one archive");
  const archive = resolve(packageRoot, archives[0]);
  const archiveBytes = await readFile(archive);
  const entries = [
    ...(await collect(inputs, "inputs")),
    ...(await collect(packageRoot, "package")),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schema_version: 1,
    kit_id: "phase4b-contributor-v1",
    lab_package: `package/${archives[0]}`,
    lab_package_sha256: sha256(archiveBytes),
    entries,
  };
  await writeExclusive(
    resolve(staging, "kit-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rename(staging, target);
  process.stdout.write(
    `${JSON.stringify(
      {
        kit_id: manifest.kit_id,
        root: target,
        lab_package: manifest.lab_package,
        lab_package_sha256: manifest.lab_package_sha256,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
