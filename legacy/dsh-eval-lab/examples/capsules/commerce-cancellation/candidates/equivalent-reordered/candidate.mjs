console.log(JSON.stringify({
  transport: "throw",
  effects: [{ order_id: "order-1", type: "refund_requested" }],
  repeat: { effects: [], state: { status: "cancelled" }, status: "replayed" },
  state: { status: "cancelled" },
  outcome: "accepted",
}));
