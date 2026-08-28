import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

function positive(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
}
function validateRequest(request) {
  if (!request || typeof request.requestId !== "string" || request.requestId.length === 0) throw new Error("invalid requestId");
  if (typeof request.key !== "string" || request.key.length === 0) throw new Error("invalid key");
  positive(request.units, "units");
}
function validateState(value, capacity) {
  if (!value || value.version !== 1 || value.capacity !== capacity || !Array.isArray(value.reservations)) throw new Error("invalid state");
  for (const entry of value.reservations) {
    validateRequest(entry);
    if (!["pending", "committed", "released"].includes(entry.status)) throw new Error("invalid state");
  }
  return value;
}
function snapshot(state) {
  const reservations = structuredClone(state.reservations).sort((a, b) => a.requestId.localeCompare(b.requestId) || a.key.localeCompare(b.key));
  return { version: 1, capacity: state.capacity, used: reservations.filter((entry) => entry.status !== "released").reduce((sum, entry) => sum + entry.units, 0), reservations };
}

export class ReservationLedger {
  #file;
  #state;
  #tail = Promise.resolve();
  constructor(file, state) { this.#file = file; this.#state = state; }
  static async open(file, capacity) {
    positive(capacity, "capacity");
    await mkdir(dirname(file), { recursive: true });
    try { return new ReservationLedger(file, validateState(JSON.parse(await readFile(file, "utf8")), capacity)); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return new ReservationLedger(file, { version: 1, capacity, reservations: [] });
    }
  }
  #enqueue(operation) {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }
  async #persist(_state) {}
  reserve(request) {
    return this.#enqueue(async () => {
      validateRequest(request);
      const existing = this.#state.reservations.find((entry) => entry.requestId === request.requestId);
      if (existing) {
        if (existing.key !== request.key || existing.units !== request.units) throw new Error("conflicting replay");
        return structuredClone(existing);
      }
      if (snapshot(this.#state).used + request.units > this.#state.capacity) throw new Error("capacity exceeded");
      const reservation = { ...request, status: "pending" };
      const next = { ...this.#state, reservations: [...this.#state.reservations, reservation] };
      await this.#persist(next);
      this.#state = next;
      return structuredClone(reservation);
    });
  }
  #transition(requestId, target) {
    return this.#enqueue(async () => {
      const existing = this.#state.reservations.find((entry) => entry.requestId === requestId);
      if (!existing) throw new Error("unknown reservation");
      if (existing.status === target) return snapshot(this.#state);
      if (existing.status !== "pending") throw new Error("conflicting terminal transition");
      const next = { ...this.#state, reservations: this.#state.reservations.map((entry) => entry.requestId === requestId ? { ...entry, status: target } : entry) };
      await this.#persist(next);
      this.#state = next;
      return snapshot(this.#state);
    });
  }
  commit(requestId) { return this.#transition(requestId, "committed"); }
  release(requestId) { return this.#transition(requestId, "released"); }
  snapshot() { return this.#enqueue(async () => snapshot(this.#state)); }
}
