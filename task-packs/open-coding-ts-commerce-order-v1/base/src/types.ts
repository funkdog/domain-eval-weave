export type OrderStatus = "pending_payment" | "paid" | "shipped" | "cancelled";
export type RefundStatus = "none" | "pending" | "refunded";

export interface CouponState {
  id: string;
  expiresAt: string;
  restored: boolean;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  listAmount: number;
  paidAmount: number;
  inventoryReserved: boolean;
  coupon?: CouponState;
  refundStatus: RefundStatus;
  refundAmount: number;
}

export interface CancellationInput {
  orderId: string;
  customerId: string;
  requestId: string;
  now: string;
}

export interface CancellationResult {
  order: Order;
  inventoryReleased: boolean;
  couponRestored: boolean;
  refundRequested: boolean;
}

export interface AuditEvent {
  sequence: number;
  orderId: string;
  requestId: string;
  type: "order_cancelled" | "refund_requested" | "inventory_released" | "coupon_restored" | "refund_completed";
  occurredAt: string;
  amount?: number;
}
