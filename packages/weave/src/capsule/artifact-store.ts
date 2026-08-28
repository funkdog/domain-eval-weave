import { open, readFile } from "node:fs/promises";

export async function writeExclusiveOrVerify(
  path: string,
  bytes: Uint8Array,
  collisionError: () => Error,
): Promise<void> {
  const expected = Buffer.from(bytes);
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(expected);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await readFile(path)).equals(expected)) throw collisionError();
  }
}
