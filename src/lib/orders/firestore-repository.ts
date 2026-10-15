import "server-only";

import { COLLECTIONS, ORDERS_LIST_CAP, TEXT_LIMITS } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { isOrderId, isViewerId } from "@/lib/orders/id";
import { ORDER_CURRENCY } from "@/lib/orders/money";
import {
  pageOrders,
  ORDER_PROVIDER,
  type OrderAccess,
  type OrderPage,
  type OrderRecord,
  type OrderRepository,
} from "@/lib/orders/repository";
import { isPublicHttpUrl } from "@/lib/orders/schema";
import { isOrderStatus } from "@/lib/orders/status";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOrder(id: string, data: unknown): OrderRecord | null {
  if (!isOrderId(id) || !isRecord(data)) return null;
  if (typeof data.userId !== "string" || !isViewerId(data.userId)) return null;
  if (typeof data.serviceId !== "number" || !Number.isSafeInteger(data.serviceId) || data.serviceId <= 0) {
    return null;
  }
  if (typeof data.serviceName !== "string" || data.serviceName.length === 0 || data.serviceName.length > TEXT_LIMITS.serviceName) {
    return null;
  }
  if (typeof data.category !== "string" || data.category.length > TEXT_LIMITS.category) return null;
  if (typeof data.targetUrl !== "string" || !isPublicHttpUrl(data.targetUrl)) return null;
  if (typeof data.quantity !== "number" || !Number.isSafeInteger(data.quantity) || data.quantity <= 0) return null;
  if (data.currency !== ORDER_CURRENCY) return null;
  if (typeof data.salePriceMinor !== "number" || !Number.isSafeInteger(data.salePriceMinor) || data.salePriceMinor <= 0) {
    return null;
  }
  if (data.provider !== ORDER_PROVIDER) return null;
  if (data.providerOrderId !== null || data.providerStatus !== null) return null;
  if (!isOrderStatus(data.status)) return null;
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.length < 32 || data.idempotencyKey.length > 64) {
    return null;
  }
  if (typeof data.createdAt !== "string" || data.createdAt.length === 0 || data.createdAt.length > 40) return null;
  if (typeof data.updatedAt !== "string" || data.updatedAt.length === 0 || data.updatedAt.length > 40) return null;

  return {
    id,
    userId: data.userId,
    serviceId: data.serviceId,
    serviceName: data.serviceName,
    category: data.category,
    targetUrl: data.targetUrl,
    quantity: data.quantity,
    currency: ORDER_CURRENCY,
    salePriceMinor: data.salePriceMinor,
    pricingRole: data.pricingRole === "dealer" ? "dealer" : "user",
    pricingMultiplier:
      typeof data.pricingMultiplier === "number" && Number.isFinite(data.pricingMultiplier) && data.pricingMultiplier > 0
        ? data.pricingMultiplier
        : null,
    provider: ORDER_PROVIDER,
    providerOrderId: null,
    providerStatus: null,
    refillSupported: typeof data.refillSupported === "boolean" ? data.refillSupported : null,
    cancelSupported: typeof data.cancelSupported === "boolean" ? data.cancelSupported : null,
    status: data.status,
    idempotencyKey: data.idempotencyKey,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function createFirestoreOrderRepository(): OrderRepository {
  const database = getAdminFirestore();

  return {
    async createOrGet(): Promise<{ record: OrderRecord; created: boolean }> {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "unpaid_order_create");
    },

    async listByUser(userId: string, page: number): Promise<OrderPage> {
      if (!isViewerId(userId)) return pageOrders([], page);
      const snapshot = await database
        .collection(COLLECTIONS.orders)
        .where("userId", "==", userId)
        .limit(ORDERS_LIST_CAP)
        .get();

      const records = snapshot.docs
        .map((document) => parseOrder(document.id, document.data()))
        .filter((order): order is OrderRecord => order !== null && order.userId === userId)
        .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
      return pageOrders(records, page);
    },

    async accessForUser(orderId: string, userId: string): Promise<OrderAccess> {
      if (!isViewerId(userId) || !isOrderId(orderId)) return { kind: "missing" };
      const snapshot = await database.collection(COLLECTIONS.orders).doc(orderId).get();
      if (!snapshot.exists) return { kind: "missing" };
      const record = parseOrder(snapshot.id, snapshot.data());
      if (!record) return { kind: "missing" };
      if (record.userId !== userId) return { kind: "foreign" };
      return { kind: "own", record };
    },

    async getForUser(orderId: string, userId: string): Promise<OrderRecord | null> {
      const access = await this.accessForUser(orderId, userId);
      return access.kind === "own" ? access.record : null;
    },
  };
}
