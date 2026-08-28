export interface SessionInventoryEntry {
  readonly id: string;
  readonly cwd?: string;
  readonly createdAt: number;
  readonly delegationDepth: number;
}

export class SessionDiscoveryError extends Error {
  readonly code = "SESSION_DISCOVERY_AMBIGUOUS";
}

export function discoverFreshSession(input: {
  readonly before: readonly SessionInventoryEntry[];
  readonly after: readonly SessionInventoryEntry[];
  readonly workspace: string;
  readonly startedAt: string;
  readonly endedAt: string;
}): SessionInventoryEntry {
  const previousIds = new Set(input.before.map((entry) => entry.id));
  const started = Date.parse(input.startedAt);
  const ended = Date.parse(input.endedAt);
  const candidates = input.after.filter((entry) => {
    const created = entry.createdAt;
    return (
      !previousIds.has(entry.id) &&
      entry.cwd === input.workspace &&
      entry.delegationDepth === 0 &&
      Number.isFinite(created) &&
      created >= started &&
      created <= ended
    );
  });
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new SessionDiscoveryError("expected exactly one fresh root Session for the arm");
  }
  return candidates[0];
}
