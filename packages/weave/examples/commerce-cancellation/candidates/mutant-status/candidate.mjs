console.log(JSON.stringify({
  outcome: "accepted",
  transport: "throw",
  state: { status: "paid" },
  effects: [{ type: "refund_requested", order_id: "order-1" }],
  repeat: { status: "replayed", state: { status: "paid" }, effects: [] },
}));
