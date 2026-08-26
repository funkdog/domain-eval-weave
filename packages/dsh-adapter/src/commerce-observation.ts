import { z } from "zod";

const stateFieldSchema = z.strictObject({
  field_id: z.string(),
  value: z.strictObject({
    domain_id: z.string(),
    scalar: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
});
const effectSchema = z.strictObject({
  effect_id: z.string(),
  identity: z.array(z.unknown()),
  attributes: z.array(z.unknown()),
});
const normalFormSchema = z.strictObject({
  schema_version: z.literal(1),
  operation: z.strictObject({ status: z.enum(["accepted", "rejected", "unavailable"]) }),
  state: z.array(stateFieldSchema),
  effects: z.array(effectSchema),
  relations: z.array(z.strictObject({ relation_id: z.string(), status: z.boolean() })),
});
const scenarioSchema = z.object({
  operations: z.record(z.string(), z.enum(["accepted", "rejected", "unavailable"])),
  normal_forms: z.record(z.string(), normalFormSchema),
});

function effects(value: z.infer<typeof normalFormSchema> | undefined) {
  return (value?.effects ?? []).map((effect) => ({ type: effect.effect_id }));
}

export function normalizeCommerceCapsuleObservation(input: {
  readonly paidUnstarted: unknown;
  readonly requestReplay: unknown;
}) {
  const paid = scenarioSchema.parse(input.paidUnstarted);
  const replay = scenarioSchema.parse(input.requestReplay);
  const after = paid.normal_forms.after;
  const replayForm = replay.normal_forms.replay;
  const status = after?.state.find((field) => field.field_id === "order_status")?.value.scalar;
  const replayRelation = replayForm?.relations.find(
    (relation) => relation.relation_id === "request_replay_same_as_first",
  );
  const replayStatus =
    replay.operations.cancel_order !== "accepted"
      ? "unavailable"
      : replayRelation?.status === true
        ? "replayed"
        : "diverged";
  return {
    state: { status: typeof status === "string" ? status : "unavailable" },
    effects: effects(after),
    repeat: { status: replayStatus, effects: effects(replayForm) },
  };
}
