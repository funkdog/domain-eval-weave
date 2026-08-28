console.log(JSON.stringify({
  outcome: "accepted",
  transport: "throw",
  state: { status: "cancelled" },
  effects: [{ type: "refund_requested", order_id: "order-1" }],
  repeat: { status: "unavailable", state: { status: "cancelled" }, effects: [] },
}));
