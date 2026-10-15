import { AppError } from "@/lib/http/errors";
import { isOrderId, isViewerId, orderDocumentId } from "@/lib/orders/id";
import {
  buildOrderRecord,
  pageOrders,
  type NewOrder,
  type OrderAccess,
  type OrderPage,
  type OrderRecord,
  type OrderRepository,
} from "@/lib/orders/repository";

export class MemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly costs = new Map<string, number>();
  private readonly tails = new Map<string, Promise<void>>();

  async createOrGet(input: NewOrder): Promise<{ record: OrderRecord; created: boolean }> {
    const id = orderDocumentId(input.userId, input.idempotencyKey);
    return this.exclusive(id, () => {
      const existing = this.orders.get(id);
      if (existing) {
        if (existing.userId !== input.userId) {
          throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
        }
        return { record: existing, created: false };
      }

      const record = buildOrderRecord(id, input, new Date().toISOString());
      this.orders.set(id, record);
      this.costs.set(id, input.providerCostMinor);
      return { record, created: true };
    });
  }

  async listByUser(userId: string, page: number): Promise<OrderPage> {
    if (!isViewerId(userId)) return pageOrders([], page);
    const records = [...this.orders.values()]
      .filter((order) => order.userId === userId)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
    return pageOrders(records, page);
  }

  async accessForUser(orderId: string, userId: string): Promise<OrderAccess> {
    if (!isViewerId(userId) || !isOrderId(orderId)) return { kind: "missing" };
    const record = this.orders.get(orderId);
    if (!record) return { kind: "missing" };
    if (record.userId !== userId) return { kind: "foreign" };
    return { kind: "own", record };
  }

  async getForUser(orderId: string, userId: string): Promise<OrderRecord | null> {
    const access = await this.accessForUser(orderId, userId);
    return access.kind === "own" ? access.record : null;
  }

  readProviderCost(orderId: string): number | undefined {
    return this.costs.get(orderId);
  }

  size(): number {
    return this.orders.size;
  }

  private async exclusive<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(
      key,
      previous.then(() => gate),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
