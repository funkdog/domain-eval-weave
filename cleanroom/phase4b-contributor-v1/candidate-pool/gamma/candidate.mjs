console.log(
  JSON.stringify({
    state: { status: "return_pending" },
    effects: [{ type: "refund_requested" }],
    repeat: { status: "replayed", effects: [] },
    transport: "typed_result",
  }),
);
