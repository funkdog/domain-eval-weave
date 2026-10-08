import type {
  AuditEvent,
  CancellationInput,
  CancellationResult,
  Order,
  RetentionPolicy,
  WithdrawalResolutionInput,
} from "./types.ts";

export class OrderService {
  static async open(_storePath: string): Promise<OrderService> {
    return new OrderService();
  }

  async createOrder(_order: Order): Promise<void> {
    throw new Error("Not implemented");
  }

  async cancelOrder(_input: CancellationInput): Promise<CancellationResult> {
    throw new Error("Not implemented");
  }

  async resolveWithdrawal(_input: WithdrawalResolutionInput): Promise<CancellationResult> {
    throw new Error("Not implemented");
  }

  async markRefunded(_orderId: string): Promise<Order> {
    throw new Error("Not implemented");
  }

  async getOrder(_orderId: string): Promise<Order | null> {
    throw new Error("Not implemented");
  }

  async getAuditEvents(_orderId: string): Promise<readonly AuditEvent[]> {
    throw new Error("Not implemented");
  }

  async getRetentionPolicy(): Promise<RetentionPolicy> {
    throw new Error("Not implemented");
  }
}
