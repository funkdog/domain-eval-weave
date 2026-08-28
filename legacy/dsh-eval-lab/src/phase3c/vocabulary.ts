export const PHASE3C_OPERATIONS = [
  "create_order",
  "cancel_order",
  "resolve_withdrawal",
  "mark_refunded",
  "get_order",
  "get_audit",
  "get_retention",
] as const;

export const PHASE3C_STATE_FIELDS = [
  "order_status",
  "fulfillment_state",
  "withdrawal_state",
  "refund_status",
  "refund_amount",
  "currency",
  "inventory_reserved",
  "coupon_state",
  "version",
] as const;

export const PHASE3C_EFFECTS = [
  "order_cancelled",
  "refund_requested",
  "inventory_compensated",
  "coupon_restored",
  "command_rejected",
  "withdrawal_requested",
  "withdrawal_completed",
  "idempotency_conflict",
] as const;

export const PHASE3C_EFFECT_FIELDS = [
  "order_id",
  "request_id",
  "effect_key",
  "amount",
  "currency",
  "eligibility",
  "provider_ref",
] as const;

export const PHASE3C_STIMULI = [
  "unpaid_order",
  "paid_order",
  "active_fulfillment_order",
  "handed_off_order",
  "replay_request",
  "restart_checkpoint",
  "retention_clock",
] as const;

export const PHASE3C_STIMULUS_FIELDS = [
  "order_id",
  "customer_id",
  "request_id",
  "paid_amount",
  "currency",
  "coupon_expiry",
  "provider_ref",
  "now",
] as const;

export const PHASE3C_NORMAL_FORM_SLOTS = ["before", "after", "first", "replay", "restart"] as const;

export const PHASE3C_RELATIONS = [
  "withdrawal_before_cancellation",
  "request_replay_same_as_first",
  "restart_preserves_public_state",
] as const;

export const PHASE3C_SCALAR_DOMAINS = [
  "order_status_enum",
  "fulfillment_state_enum",
  "withdrawal_state_enum",
  "refund_status_enum",
  "currency_enum",
  "coupon_state_enum",
  "boolean",
  "nonnegative_integer",
  "nonnegative_minor_units",
  "positive_version",
  "opaque_id",
  "timestamp",
] as const;

export const PHASE3C_OPERATION_DIMENSIONS = PHASE3C_OPERATIONS.map(
  (operation) => `${operation}_outcome` as const,
);
export const PHASE3C_STATE_DIMENSIONS = PHASE3C_STATE_FIELDS.map(
  (field) => `${field}_state` as const,
);
export const PHASE3C_EFFECT_DIMENSIONS = PHASE3C_EFFECTS.map(
  (effect) => `${effect}_effect` as const,
);
export const PHASE3C_RELATION_DIMENSIONS = [...PHASE3C_RELATIONS] as const;
export const PHASE3C_RETENTION_DIMENSIONS = ["retention_window"] as const;
export const PHASE3C_DIMENSIONS = [
  ...PHASE3C_OPERATION_DIMENSIONS,
  ...PHASE3C_STATE_DIMENSIONS,
  ...PHASE3C_EFFECT_DIMENSIONS,
  ...PHASE3C_RELATION_DIMENSIONS,
  ...PHASE3C_RETENTION_DIMENSIONS,
] as const;

export type Phase3cOperation = (typeof PHASE3C_OPERATIONS)[number];
export type Phase3cStateField = (typeof PHASE3C_STATE_FIELDS)[number];
export type Phase3cEffect = (typeof PHASE3C_EFFECTS)[number];
export type Phase3cEffectField = (typeof PHASE3C_EFFECT_FIELDS)[number];
export type Phase3cStimulus = (typeof PHASE3C_STIMULI)[number];
export type Phase3cStimulusField = (typeof PHASE3C_STIMULUS_FIELDS)[number];
export type Phase3cNormalFormSlot = (typeof PHASE3C_NORMAL_FORM_SLOTS)[number];
export type Phase3cRelation = (typeof PHASE3C_RELATIONS)[number];
export type Phase3cScalarDomain = (typeof PHASE3C_SCALAR_DOMAINS)[number];
export type Phase3cDimension = (typeof PHASE3C_DIMENSIONS)[number];

export const OPERATION_DIMENSION = Object.fromEntries(
  PHASE3C_OPERATIONS.map((operation) => [operation, `${operation}_outcome`]),
) as Readonly<Record<Phase3cOperation, Phase3cDimension>>;
export const STATE_DIMENSION = Object.fromEntries(
  PHASE3C_STATE_FIELDS.map((field) => [field, `${field}_state`]),
) as Readonly<Record<Phase3cStateField, Phase3cDimension>>;
export const EFFECT_DIMENSION = Object.fromEntries(
  PHASE3C_EFFECTS.map((effect) => [effect, `${effect}_effect`]),
) as Readonly<Record<Phase3cEffect, Phase3cDimension>>;

export const STATE_FIELD_DOMAIN: Readonly<Record<Phase3cStateField, Phase3cScalarDomain>> = {
  order_status: "order_status_enum",
  fulfillment_state: "fulfillment_state_enum",
  withdrawal_state: "withdrawal_state_enum",
  refund_status: "refund_status_enum",
  refund_amount: "nonnegative_minor_units",
  currency: "currency_enum",
  inventory_reserved: "boolean",
  coupon_state: "coupon_state_enum",
  version: "positive_version",
};

export const EFFECT_FIELD_DOMAIN: Readonly<Record<Phase3cEffectField, Phase3cScalarDomain>> = {
  order_id: "opaque_id",
  request_id: "opaque_id",
  effect_key: "opaque_id",
  amount: "nonnegative_minor_units",
  currency: "currency_enum",
  eligibility: "boolean",
  provider_ref: "opaque_id",
};

export const STIMULUS_FIELD_DOMAIN: Readonly<Record<Phase3cStimulusField, Phase3cScalarDomain>> = {
  order_id: "opaque_id",
  customer_id: "opaque_id",
  request_id: "opaque_id",
  paid_amount: "nonnegative_minor_units",
  currency: "currency_enum",
  coupon_expiry: "timestamp",
  provider_ref: "opaque_id",
  now: "timestamp",
};

export const EFFECT_FIELDS: Readonly<
  Record<
    Phase3cEffect,
    {
      readonly identity: readonly Phase3cEffectField[];
      readonly attributes: readonly Phase3cEffectField[];
    }
  >
> = {
  order_cancelled: { identity: ["order_id", "request_id"], attributes: [] },
  refund_requested: { identity: ["order_id", "effect_key"], attributes: ["amount", "currency"] },
  inventory_compensated: { identity: ["order_id", "effect_key"], attributes: [] },
  coupon_restored: { identity: ["order_id", "effect_key"], attributes: ["eligibility"] },
  command_rejected: { identity: ["order_id", "request_id"], attributes: [] },
  withdrawal_requested: { identity: ["order_id", "request_id"], attributes: ["provider_ref"] },
  withdrawal_completed: { identity: ["order_id", "request_id"], attributes: ["provider_ref"] },
  idempotency_conflict: { identity: ["order_id", "request_id"], attributes: [] },
};

export const PHASE3C_PUBLIC_OBSERVATION_CATALOG = {
  schema_version: 1,
  catalog_id: "commerce-order-public-observations-v3",
  template_id: "commerce-order-cancellation-v3",
  operations: PHASE3C_OPERATIONS,
  state_fields: PHASE3C_STATE_FIELDS,
  effects: PHASE3C_EFFECTS,
  effect_fields: PHASE3C_EFFECT_FIELDS,
  stimuli: PHASE3C_STIMULI,
  stimulus_fields: PHASE3C_STIMULUS_FIELDS,
  normal_form_slots: PHASE3C_NORMAL_FORM_SLOTS,
  relations: PHASE3C_RELATIONS,
  scalar_domains: PHASE3C_SCALAR_DOMAINS,
  dimensions: PHASE3C_DIMENSIONS,
  state_field_domains: STATE_FIELD_DOMAIN,
  effect_field_domains: EFFECT_FIELD_DOMAIN,
  stimulus_field_domains: STIMULUS_FIELD_DOMAIN,
  effect_shapes: EFFECT_FIELDS,
} as const;
