console.log(
  JSON.stringify({
    state: { status: "return_accepted" },
    effects: [{ type: "refund_requested" }],
    repeat: { status: "unavailable", effects: [] },
    transport: "typed_result",
  }),
);
