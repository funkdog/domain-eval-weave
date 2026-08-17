import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeEntry(entry: string): string {
  const withoutDot = entry.startsWith("./") ? entry.slice(2) : entry;
  if (withoutDot.length === 0) return "";
  const normalized = normalize(withoutDot).split("\\").join("/");
  if (
    withoutDot.includes("\\") ||
    isAbsolute(withoutDot) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("candidate archive contains an unsafe path");
  }
  return normalized.replace(/\/$/, "");
}

export async function extractCandidateArchive(
  archivePath: string,
  destination: string,
): Promise<{ readonly entries: readonly string[] }> {
  const [{ stdout: namesOutput }, { stdout: verboseOutput }] = await Promise.all([
    execFileAsync("/usr/bin/tar", ["-tf", archivePath], { maxBuffer: 16 * 1024 * 1024 }),
    execFileAsync("/usr/bin/tar", ["-tvf", archivePath], { maxBuffer: 16 * 1024 * 1024 }),
  ]);
  const rawNames = namesOutput.split("\n").filter((line) => line.length > 0);
  const verbose = verboseOutput.split("\n").filter((line) => line.length > 0);
  if (rawNames.length !== verbose.length || rawNames.length === 0) {
    throw new Error("candidate archive listing is inconsistent");
  }
  const entries = rawNames.map(normalizeEntry).filter((entry) => entry.length > 0);
  if (new Set(entries).size !== entries.length)
    throw new Error("candidate archive has duplicate paths");
  for (const line of verbose) {
    const type = line[0];
    if (type !== "-" && type !== "d")
      throw new Error("candidate archive has a forbidden entry type");
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await execFileAsync("/usr/bin/tar", ["-xf", archivePath, "-C", destination], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return { entries };
}
