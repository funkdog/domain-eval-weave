import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type CampaignPhase =
  | "prepared"
  | "qualified"
  | "arm_1_running"
  | "arm_1_frozen"
  | "arm_2_running"
  | "arm_2_frozen"
  | "oracle_running"
  | "projected"
  | "reported"
  | "interrupted";

export interface CampaignState {
  readonly schema_version: 1;
  readonly campaign_id: string;
  readonly phase: CampaignPhase;
  readonly revision: number;
}

const TRANSITIONS: Readonly<Record<CampaignPhase, readonly CampaignPhase[]>> = {
  prepared: ["qualified", "interrupted"],
  qualified: ["arm_1_running", "interrupted"],
  arm_1_running: ["arm_1_frozen", "interrupted"],
  arm_1_frozen: ["arm_2_running", "interrupted"],
  arm_2_running: ["arm_2_frozen", "interrupted"],
  arm_2_frozen: ["oracle_running", "interrupted"],
  oracle_running: ["projected", "interrupted"],
  projected: ["reported", "interrupted"],
  reported: [],
  interrupted: [],
};

export class CampaignStateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CampaignStateError";
    this.code = code;
  }
}

export class CampaignStateStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async #write(state: CampaignState, exclusive = false): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    if (exclusive) {
      await writeFile(this.#path, JSON.stringify(state), { flag: "wx", mode: 0o600 });
      return;
    }
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temporary, this.#path);
  }

  async initialize(campaignId: string): Promise<CampaignState> {
    const state: CampaignState = {
      schema_version: 1,
      campaign_id: campaignId,
      phase: "prepared",
      revision: 0,
    };
    try {
      await this.#write(state, true);
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.read();
      if (existing.campaign_id !== campaignId) {
        throw new CampaignStateError("CAMPAIGN_STATE_COLLISION", "Campaign state id mismatch");
      }
      return existing;
    }
  }

  async read(): Promise<CampaignState> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.#path, "utf8"));
    } catch {
      throw new CampaignStateError("CAMPAIGN_STATE_INVALID", "Campaign state is unreadable");
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (value as { schema_version?: unknown }).schema_version !== 1 ||
      typeof (value as { campaign_id?: unknown }).campaign_id !== "string" ||
      !Object.hasOwn(TRANSITIONS, String((value as { phase?: unknown }).phase)) ||
      !Number.isSafeInteger((value as { revision?: unknown }).revision)
    ) {
      throw new CampaignStateError("CAMPAIGN_STATE_INVALID", "Campaign state contract is invalid");
    }
    return value as CampaignState;
  }

  async transition(next: CampaignPhase): Promise<CampaignState> {
    const current = await this.read();
    if (!TRANSITIONS[current.phase].includes(next)) {
      throw new CampaignStateError(
        "CAMPAIGN_TRANSITION_INVALID",
        `cannot transition Campaign from ${current.phase} to ${next}`,
      );
    }
    const updated: CampaignState = { ...current, phase: next, revision: current.revision + 1 };
    await this.#write(updated);
    return updated;
  }

  async recoverAfterCrash(): Promise<CampaignState> {
    const current = await this.read();
    if (current.phase === "reported" || current.phase === "interrupted") return current;
    if (current.phase === "projected") return current;
    return this.transition("interrupted");
  }
}
