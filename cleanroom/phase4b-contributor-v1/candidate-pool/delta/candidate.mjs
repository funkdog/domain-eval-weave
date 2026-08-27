console.log(
  JSON.stringify({
    state: { status: "return_accepted" },
    effects: [{ type: "refund_requested" }, { type: "refund_requested" }],
    repeat: { status: "replayed", effects: [] },
    transport: "throw",
  }),
);
