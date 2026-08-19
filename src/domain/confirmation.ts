import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import { type OwnerConfirmationEvent, parseOwnerConfirmationEvent } from "./contracts.js";

export type ConfirmationTargetKind = OwnerConfirmationEvent["target"]["kind"];

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("confirmation target must be an object");
  }
  return value as Record<string, unknown>;
}

function select(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

export function confirmationProjection(kind: ConfirmationTargetKind, target: unknown): unknown {
  const value = record(target);
  switch (kind) {
    case "evidence_card":
      return select(value, [
        "schema_version",
        "card_id",
        "revision",
        "predecessor",
        "product_id",
        "domain_id",
        "claim_id",
        "statement",
        "applicability",
        "source_refs",
        "authority_ref_ids",
        "observation_ref_ids",
        "false_accept_risk",
        "false_reject_risk",
        "conflict",
      ]);
    case "product_domain_contract":
      return select(value, [
        "schema_version",
        "contract_id",
        "product_id",
        "version",
        "predecessor",
        "source_snapshot_digest",
        "claims",
      ]);
    case "requirement_change_set":
      return select(value, [
        "schema_version",
        "requirement_id",
        "version",
        "predecessor",
        "product_id",
        "requirement_refs",
        "base_contract",
        "effects",
        "decision_question_refs",
      ]);
    case "decision_question":
      return select(value, [
        "schema_version",
        "question_id",
        "revision",
        "predecessor",
        "product_id",
        "requirement_id",
        "question",
        "reason",
        "blocked_claim_ids",
        "risk",
        "blocking",
      ]);
  }
}

export function confirmationProjectionDigest(
  kind: ConfirmationTargetKind,
  target: unknown,
): string {
  return canonicalJsonDigest(confirmationProjection(kind, target));
}

export interface ConfirmationTargetIdentity {
  readonly objectId: string;
  readonly objectVersion: number | undefined;
  readonly productId: string;
  readonly domainIds: readonly string[];
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`confirmation target ${field} must be a string`);
  return value;
}

function versionValue(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error("confirmation target version must be a positive integer");
  }
  return value as number;
}

export function confirmationTargetIdentity(
  kind: ConfirmationTargetKind,
  target: unknown,
): ConfirmationTargetIdentity {
  const value = record(target);
  switch (kind) {
    case "evidence_card":
      return {
        objectId: stringValue(value.card_id, "card_id"),
        objectVersion: versionValue(value.revision),
        productId: stringValue(value.product_id, "product_id"),
        domainIds: [stringValue(value.domain_id, "domain_id")],
      };
    case "product_domain_contract":
      return {
        objectId: stringValue(value.contract_id, "contract_id"),
        objectVersion: versionValue(value.version),
        productId: stringValue(value.product_id, "product_id"),
        domainIds: Array.isArray(value.claims)
          ? value.claims.map((claim) => stringValue(record(claim).domain_id, "claim.domain_id"))
          : [],
      };
    case "requirement_change_set":
      return {
        objectId: stringValue(value.requirement_id, "requirement_id"),
        objectVersion: versionValue(value.version),
        productId: stringValue(value.product_id, "product_id"),
        domainIds: [],
      };
    case "decision_question":
      return {
        objectId: stringValue(value.question_id, "question_id"),
        objectVersion: versionValue(value.revision),
        productId: stringValue(value.product_id, "product_id"),
        domainIds: [],
      };
  }
}

export function assertOwnerConfirmation(
  candidate: unknown,
  kind: ConfirmationTargetKind,
  target: unknown,
  expectedDecision: OwnerConfirmationEvent["decision"],
): OwnerConfirmationEvent {
  const event = parseOwnerConfirmationEvent(candidate);
  const targetIdentity = confirmationTargetIdentity(kind, target);
  if (
    event.target.kind !== kind ||
    event.target.object_id !== targetIdentity.objectId ||
    event.target.object_version !== targetIdentity.objectVersion ||
    event.target.projection_sha256 !== confirmationProjectionDigest(kind, target) ||
    event.decision !== expectedDecision ||
    event.authority_scope.product_id !== targetIdentity.productId ||
    targetIdentity.domainIds.some(
      (domainId) =>
        typeof domainId !== "string" || !event.authority_scope.domain_ids.includes(domainId),
    )
  ) {
    throw new Error("OwnerConfirmationEvent does not authorize the target projection");
  }
  return event;
}
