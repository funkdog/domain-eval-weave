export type OrderStatus = "pending_payment" | "paid" | "cancelled" | "closed";
export type FulfillmentState = "not_started" | "active" | "handed_off";
export type WithdrawalState = "none" | "pending" | "completed" | "rejected" | "failed";
export type RefundStatus = "none" | "pending" | "refunded" | "failed";
export type CustomerCancellationStatus =
  | "open"
  | "cancellation_pending_fulfilment"
  | "cancelled"
  | "cancellation_rejected"
  | "cancellation_failed"
  | "after_sales_required";

export interface CouponState {
  id: string;
  expiresAt: string;
  restored: boolean;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  fulfillmentState: FulfillmentState;
  withdrawalState: WithdrawalState;
  listAmount: number;
  paidAmount: number;
  currency: string;
  inventoryReserved: boolean;
  coupon?: CouponState;
  refundStatus: RefundStatus;
  refundAmount: number;
  version: number;
}

export interface CancellationInput {
  orderId: string;
  customerId: string;
  requestId: string;
  now: string;
}

export interface WithdrawalResolutionInput {
  orderId: string;
  requestId: string;
  providerRef: string;
  outcome: "completed" | "rejected" | "failed";
  now: string;
}

export interface CancellationResult {
  order: Order;
  customerStatus: CustomerCancellationStatus;
  inventoryReleased: boolean;
  couponRestored: boolean;
  refundRequested: boolean;
}

export interface AuditEvent {
  sequence: number;
  orderId: string;
  requestId: string;
  type:
    | "cancellation_requested"
    | "withdrawal_requested"
    | "withdrawal_completed"
    | "withdrawal_rejected"
    | "withdrawal_failed"
    | "order_cancelled"
    | "refund_requested"
    | "inventory_compensated"
    | "coupon_restored"
    | "refund_completed"
    | "command_rejected"
    | "idempotency_conflict"
    | "recovery_replayed";
  operation: "cancel_order" | "resolve_withdrawal" | "mark_refunded";
  actorId: string;
  actorScope: "order-owner" | "system";
  outcome: "accepted" | "pending" | "completed" | "rejected" | "failed" | "replayed";
  reason: string;
  beforeVersion: number;
  afterVersion: number;
  policyVersion: "commerce-order-cancellation-v2";
  correlationId: string;
  causationId: string;
  occurredAt: string;
  amount?: number;
  currency?: string;
  providerRef?: string;
  recoveryRef?: string;
}

export interface RetentionPolicy {
  idempotencyDays: 90;
  financialAndOrderDays: 2555;
  securityConflictDays: 365;
  deliveryDiagnosticDays: 90;
}

export type OperationResult<T> =
  | { readonly status: "accepted"; readonly value: T }
  | { readonly status: "rejected" };
