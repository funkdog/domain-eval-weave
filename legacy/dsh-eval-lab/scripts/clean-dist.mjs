import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = resolve(repositoryRoot, "dist");

if (dirname(distRoot) !== repositoryRoot || basename(distRoot) !== "dist") {
  throw new Error("refusing to clean a path outside the repository dist directory");
}

try {
  const entry = await lstat(distRoot);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("repository dist output must be a physical directory");
  }
} catch (error) {
  if (
    error instanceof Error &&
    error.message === "repository dist output must be a physical directory"
  ) {
    throw error;
  }
  if (error.code !== "ENOENT") throw error;
}

await rm(distRoot, { recursive: true, force: true });
