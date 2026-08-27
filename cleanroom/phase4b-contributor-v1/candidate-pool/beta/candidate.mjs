console.log(
  JSON.stringify({
    transport: "typed_result",
    repeat: { effects: [], status: "replayed" },
    effects: [{ type: "refund_requested" }],
    state: { status: "return_accepted" },
  }),
);
