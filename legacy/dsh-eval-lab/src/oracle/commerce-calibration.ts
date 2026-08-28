import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import type { CommerceBehaviorVector, CommerceOrderOracle } from "./commerce-order.js";

export const COMMERCE_CALIBRATION_CANDIDATES = [
  "red",
  "gold",
  "mutant-shipped-cancel",
  "mutant-overrefund",
  "mutant-double-effects",
  "mutant-coupon-always-restored",
  "mutant-no-ownership-or-persistence",
  "gold-repeat",
  "gold-next-seed",
] as const;

export type CommerceCalibrationCandidate = (typeof COMMERCE_CALIBRATION_CANDIDATES)[number];

const mutantIdSchema = z.enum([
  "mutant-shipped-cancel",
  "mutant-overrefund",
  "mutant-double-effects",
  "mutant-coupon-always-restored",
  "mutant-no-ownership-or-persistence",
]);

const mutationOperationSchema = z.enum([
  "allow_shipped_cancel",
  "refund_list_amount",
  "duplicate_inventory_on_replay",
  "restore_expired_coupon",
  "disable_ownership",
  "skip_cancellation_persist",
]);

const mutationManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    mutants: z.array(
      z.strictObject({
        candidate_id: mutantIdSchema,
        operations: z.array(mutationOperationSchema).min(1),
      }),
    ),
  })
  .superRefine((manifest, context) => {
    const ids = manifest.mutants.map((mutant) => mutant.candidate_id);
    if (new Set(ids).size !== ids.length || ids.length !== 5) {
      context.addIssue({ code: "custom", path: ["mutants"], message: "mutants must be exact" });
    }
  });

type MutationOperation = z.infer<typeof mutationOperationSchema>;

export interface CommerceCalibrationEvidence {
  readonly schema_version: 2;
  readonly template_id: "commerce-order-cancellation-v1";
  readonly vectors: Readonly<Record<CommerceCalibrationCandidate, CommerceBehaviorVector>>;
}

function replaceUnique(source: string, search: string, replacement: string): string {
  const first = source.indexOf(search);
  if (first < 0 || first !== source.lastIndexOf(search)) {
    throw new Error("commerce mutation must match one canonical Gold source location");
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function applyOperation(source: string, operation: MutationOperation): string {
  switch (operation) {
    case "allow_shipped_cancel":
      return replaceUnique(
        source,
        'if (current.status === "shipped") throw new Error("after-sales required");',
        'if (false && current.status === "shipped") throw new Error("after-sales required");',
      );
    case "refund_list_amount":
      return replaceUnique(
        source,
        "refundAmount: refundRequested ? current.paidAmount : 0,",
        "refundAmount: refundRequested ? current.listAmount : 0,",
      );
    case "duplicate_inventory_on_replay":
      return replaceUnique(
        source,
        "return clone(replay.result);",
        [
          "if (replay.result.inventoryReleased) {",
          "          const duplicate = {",
          "            sequence: this.#state.audit.length + 1,",
          "            orderId: input.orderId,",
          "            requestId: input.requestId,",
          '            type: "inventory_released",',
          "            occurredAt: input.now,",
          "          };",
          "          const replayed = { ...this.#state, audit: [...this.#state.audit, duplicate] };",
          "          await this.#persist(replayed);",
          "          this.#state = replayed;",
          "        }",
          "        return clone(replay.result);",
        ].join("\n"),
      );
    case "restore_expired_coupon":
      return replaceUnique(
        source,
        "Date.parse(current.coupon.expiresAt) >= Date.parse(input.now);",
        "true;",
      );
    case "disable_ownership":
      return replaceUnique(
        source,
        'if (current.customerId !== input.customerId) throw new Error("order ownership mismatch");',
        'if (false && current.customerId !== input.customerId) throw new Error("order ownership mismatch");',
      );
    case "skip_cancellation_persist":
      return replaceUnique(
        source,
        "await this.#persist(next); // cancellation commit",
        "await Promise.resolve(); // cancellation intentionally not persisted",
      );
  }
}

async function materializeCandidate(input: {
  readonly candidate: CommerceCalibrationCandidate;
  readonly packRoot: string;
  readonly scratchRoot: string;
}): Promise<string> {
  const candidateRoot = `${input.scratchRoot}/candidates/${input.candidate}`;
  await mkdir(`${input.scratchRoot}/candidates`, { recursive: true, mode: 0o700 });
  if (input.candidate === "red") {
    await cp(`${input.packRoot}/base`, candidateRoot, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return candidateRoot;
  }
  await cp(`${input.packRoot}/calibration/gold-equivalent`, candidateRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  if (input.candidate.startsWith("mutant-")) {
    const manifest = mutationManifestSchema.parse(
      JSON.parse(await readFile(`${input.packRoot}/calibration/mutations.json`, "utf8")),
    );
    const mutant = manifest.mutants.find((entry) => entry.candidate_id === input.candidate);
    if (mutant === undefined) throw new Error("commerce mutant is absent from manifest");
    const path = `${candidateRoot}/src/order-service.ts`;
    let source = await readFile(path, "utf8");
    for (const operation of mutant.operations) source = applyOperation(source, operation);
    await writeFile(path, source, "utf8");
  }
  return candidateRoot;
}

export async function calibrateCommercePackDetailed(input: {
  readonly oracle: CommerceOrderOracle;
  readonly packRoot: string;
  readonly scratchRoot: string;
  readonly seed: number;
}): Promise<CommerceCalibrationEvidence> {
  const entries: Array<readonly [CommerceCalibrationCandidate, CommerceBehaviorVector]> = [];
  for (const candidate of COMMERCE_CALIBRATION_CANDIDATES) {
    const candidateRoot = await materializeCandidate({
      candidate,
      packRoot: input.packRoot,
      scratchRoot: input.scratchRoot,
    });
    const vector = await input.oracle.evaluateDirectory(
      candidateRoot,
      candidate === "gold-next-seed" ? input.seed + 1 : input.seed,
      `${input.scratchRoot}/checks/${candidate}`,
    );
    entries.push([candidate, vector]);
  }
  return {
    schema_version: 2,
    template_id: "commerce-order-cancellation-v1",
    vectors: Object.fromEntries(entries) as CommerceCalibrationEvidence["vectors"],
  };
}
