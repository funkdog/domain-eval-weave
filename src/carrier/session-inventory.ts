import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SessionInventoryEntry } from "./session-discovery.js";

export interface LocatedSessionInventoryEntry extends SessionInventoryEntry {
  readonly transcriptPath: string;
}

export async function readStableSessionTranscript(
  transcriptPath: string,
  settleMs = 25,
): Promise<string> {
  const firstStat = await lstat(transcriptPath);
  if (firstStat.isSymbolicLink() || !firstStat.isFile()) {
    throw new Error("Session transcript must be a regular file");
  }
  const first = await readFile(transcriptPath);
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, settleMs));
  const secondStat = await lstat(transcriptPath);
  const second = await readFile(transcriptPath);
  if (
    secondStat.isSymbolicLink() ||
    !secondStat.isFile() ||
    firstStat.size !== secondStat.size ||
    firstStat.mtimeMs !== secondStat.mtimeMs ||
    !first.equals(second)
  ) {
    throw new Error("Session transcript is not stable after carrier exit");
  }
  return second.toString("utf8");
}

export async function scanRawSessionInventory(
  sessionsRoot: string,
): Promise<readonly LocatedSessionInventoryEntry[]> {
  const results: LocatedSessionInventoryEntry[] = [];
  const visit = async (directory: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const name of names.sort()) {
      const path = resolve(directory, name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error("Session inventory rejects symlink entries");
      if (stat.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!stat.isFile()) throw new Error("Session inventory rejects special entries");
      if (name === "session.jsonl.zstd") {
        throw new Error("compressed Session artifact found in raw-only Eval Lab store");
      }
      if (name !== "session.jsonl") continue;
      const firstLine = (await readFile(path, "utf8")).split("\n", 1)[0];
      if (firstLine === undefined) throw new Error("Session transcript is empty");
      const header = JSON.parse(firstLine) as Record<string, unknown>;
      if (
        header.type !== "session" ||
        typeof header.id !== "string" ||
        !Number.isSafeInteger(header.createdAt) ||
        (header.createdAt as number) < 0 ||
        (header.delegationDepth !== undefined &&
          (!Number.isSafeInteger(header.delegationDepth) ||
            (header.delegationDepth as number) < 0)) ||
        (header.cwd !== undefined && typeof header.cwd !== "string")
      ) {
        throw new Error("Session inventory header is invalid");
      }
      results.push({
        id: header.id,
        ...(typeof header.cwd === "string" ? { cwd: header.cwd } : {}),
        createdAt: header.createdAt as number,
        delegationDepth: (header.delegationDepth as number | undefined) ?? 0,
        transcriptPath: path,
      });
    }
  };
  await visit(resolve(sessionsRoot));
  return results;
}
