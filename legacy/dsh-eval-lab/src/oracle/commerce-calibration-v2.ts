import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import type { CommerceBehaviorVector, CommerceOrderOracle } from "./commerce-order-v2.js";

export const COMMERCE_CALIBRATION_CANDIDATES = [
  "red",
  "gold",
  "mutant-handed-off-cancel",
  "mutant-overrefund-or-currency",
  "mutant-premature-cancel",
  "mutant-withdrawal-rejection-effects",
  "mutant-withdrawal-failure-effects",
  "mutant-double-effects",
  "mutant-coupon-always-restored",
  "mutant-no-ownership",
  "mutant-no-persistence",
  "mutant-expired-replay-fresh",
  "mutant-sparse-audit",
  "gold-repeat",
  "gold-next-seed",
] as const;

export type CommerceCalibrationCandidate = (typeof COMMERCE_CALIBRATION_CANDIDATES)[number];

const mutantIdSchema = z.enum([
  "mutant-handed-off-cancel",
  "mutant-overrefund-or-currency",
  "mutant-premature-cancel",
  "mutant-withdrawal-rejection-effects",
  "mutant-withdrawal-failure-effects",
  "mutant-double-effects",
  "mutant-coupon-always-restored",
  "mutant-no-ownership",
  "mutant-no-persistence",
  "mutant-expired-replay-fresh",
  "mutant-sparse-audit",
]);

const mutationOperationSchema = z.enum([
  "allow_handed_off_cancel",
  "refund_list_amount_or_wrong_currency",
  "cancel_before_withdrawal",
  "apply_effects_on_withdrawal_rejection",
  "apply_effects_on_withdrawal_failure",
  "duplicate_inventory_on_replay",
  "restore_expired_coupon",
  "disable_ownership",
  "skip_cancellation_persist",
  "treat_expired_replay_as_fresh",
  "omit_required_audit_fields",
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
    if (new Set(ids).size !== ids.length || ids.length !== 11) {
      context.addIssue({ code: "custom", path: ["mutants"], message: "mutants must be exact" });
    }
  });

type MutationOperation = z.infer<typeof mutationOperationSchema>;

export interface CommerceCalibrationEvidence {
  readonly schema_version: 2;
  readonly template_id: "commerce-order-cancellation-v2";
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
    case "allow_handed_off_cancel":
      return replaceUnique(
        source,
        "const handedOffAllowed = false; // MUTATE:allow_handed_off_cancel",
        "const handedOffAllowed = true; // MUTATE:allow_handed_off_cancel",
      );
    case "refund_list_amount_or_wrong_currency":
      return replaceUnique(
        source,
        "? current.paidAmount // MUTATE:refund_list_amount_or_wrong_currency",
        "? current.listAmount // MUTATE:refund_list_amount_or_wrong_currency",
      );
    case "cancel_before_withdrawal":
      return replaceUnique(
        source,
        "const prematureCancel = false; // MUTATE:cancel_before_withdrawal",
        "const prematureCancel = true; // MUTATE:cancel_before_withdrawal",
      );
    case "apply_effects_on_withdrawal_rejection":
      return replaceUnique(
        source,
        "const rejectCreatesEffects = false; // MUTATE:apply_effects_on_withdrawal_rejection",
        "const rejectCreatesEffects = true; // MUTATE:apply_effects_on_withdrawal_rejection",
      );
    case "apply_effects_on_withdrawal_failure":
      return replaceUnique(
        source,
        "const failureCreatesEffects = false; // MUTATE:apply_effects_on_withdrawal_failure",
        "const failureCreatesEffects = true; // MUTATE:apply_effects_on_withdrawal_failure",
      );
    case "duplicate_inventory_on_replay":
      return replaceUnique(
        source,
        "const duplicateEffect = false; // MUTATE:duplicate_inventory_on_replay",
        "const duplicateEffect = true; // MUTATE:duplicate_inventory_on_replay",
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
        "const ownershipDisabled = false; // MUTATE:disable_ownership",
        "const ownershipDisabled = true; // MUTATE:disable_ownership",
      );
    case "skip_cancellation_persist":
      return replaceUnique(
        source,
        "await this.#persist(next); // MUTATE:skip_cancellation_persist",
        "await Promise.resolve(); // MUTATE:skip_cancellation_persist",
      );
    case "treat_expired_replay_as_fresh":
      return replaceUnique(
        source,
        "const expiredFresh = false; // MUTATE:treat_expired_replay_as_fresh",
        "const expiredFresh = true; // MUTATE:treat_expired_replay_as_fresh",
      );
    case "omit_required_audit_fields":
      return replaceUnique(
        source,
        "if (false) delete event.policyVersion; // MUTATE:omit_required_audit_fields",
        "if (true) delete event.policyVersion; // MUTATE:omit_required_audit_fields",
      );
  }
}

export async function materializeCommerceCalibrationCandidate(input: {
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
    const candidateRoot = await materializeCommerceCalibrationCandidate({
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
    template_id: "commerce-order-cancellation-v2",
    vectors: Object.fromEntries(entries) as CommerceCalibrationEvidence["vectors"],
  };
}
