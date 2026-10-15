import type { PricingRole } from "@/lib/auth/roles";
import { ORDERS_LIST_CAP, ORDERS_PAGE_SIZE } from "@/lib/constants";
import { AppError } from "@/lib/http/errors";
import { isOrderId, isViewerId } from "@/lib/orders/id";
import { ORDER_CURRENCY } from "@/lib/orders/money";
import { isPublicHttpUrl } from "@/lib/orders/schema";
import { ORDER_STATUS_PENDING, type OrderStatus } from "@/lib/orders/status";

export const ORDER_STATUS = ORDER_STATUS_PENDING;
export const ORDER_PROVIDER = "smmfull" as const;

export type NewOrder = {
  userId: string;
  serviceId: number;
  serviceName: string;
  category: string;
  targetUrl: string;
  quantity: number;
  currency: typeof ORDER_CURRENCY;
  salePriceMinor: number;
  provider: typeof ORDER_PROVIDER;
  idempotencyKey: string;
  providerCostMinor: number;
  pricingRole: PricingRole;
  pricingMultiplier: number | null;
  refillSupported?: boolean;
  cancelSupported?: boolean;
};

export type OrderRecord = {
  id: string;
  userId: string;
  serviceId: number;
  serviceName: string;
  category: string;
  targetUrl: string;
  quantity: number;
  currency: typeof ORDER_CURRENCY;
  salePriceMinor: number;
  pricingRole: PricingRole;
  pricingMultiplier: number | null;
  provider: typeof ORDER_PROVIDER;
  providerOrderId: null;
  providerStatus: null;
  refillSupported?: boolean | null;
  cancelSupported?: boolean | null;
  status: OrderStatus;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderPage = {
  records: OrderRecord[];
  total: number;
  page: number;
  pageCount: number;
};

export type OrderAccess =
  | { kind: "own"; record: OrderRecord }
  | { kind: "foreign" }
  | { kind: "missing" };

export type OrderRepository = {
  createOrGet(input: NewOrder): Promise<{ record: OrderRecord; created: boolean }>;
  listByUser(userId: string, page: number): Promise<OrderPage>;
  getForUser(orderId: string, userId: string): Promise<OrderRecord | null>;
  accessForUser(orderId: string, userId: string): Promise<OrderAccess>;
};

export function buildOrderRecord(
  id: string,
  input: NewOrder,
  now: string,
  status: OrderStatus = ORDER_STATUS_PENDING,
): OrderRecord {
  if (!isViewerId(input.userId)) {
    throw new AppError("UNAUTHENTICATED", 401, "Oturum doğrulanamadı.");
  }
  if (!isOrderId(id)) {
    throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "order_id");
  }
  if (!Number.isSafeInteger(input.serviceId) || input.serviceId <= 0) {
    throw new AppError("SERVICE_UNAVAILABLE", 400, "Hizmet bulunamadı veya siparişe kapalı.");
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  if (!Number.isSafeInteger(input.salePriceMinor) || input.salePriceMinor <= 0) {
    throw new AppError("PRICE_UNAVAILABLE", 400, "Bu hizmet için fiyat tanımlı değil.");
  }
  if (input.pricingRole !== "user" && input.pricingRole !== "dealer") {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  if (
    input.pricingMultiplier !== null &&
    (!Number.isFinite(input.pricingMultiplier) || input.pricingMultiplier <= 0)
  ) {
    throw new AppError("PRICE_UNAVAILABLE", 400, "Bu hizmet için fiyat tanımlı değil.");
  }
  if (!Number.isSafeInteger(input.providerCostMinor) || input.providerCostMinor < 0) {
    throw new AppError("PRICE_UNAVAILABLE", 400, "Bu hizmet için fiyat tanımlı değil.");
  }
  if (input.currency !== ORDER_CURRENCY || input.provider !== ORDER_PROVIDER) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  if (!isPublicHttpUrl(input.targetUrl)) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  if (input.serviceName.length === 0 || input.category.length > 120) {
    throw new AppError("SERVICE_UNAVAILABLE", 400, "Hizmet bulunamadı veya siparişe kapalı.");
  }

  return {
    id,
    userId: input.userId,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    category: input.category,
    targetUrl: input.targetUrl,
    quantity: input.quantity,
    currency: ORDER_CURRENCY,
    salePriceMinor: input.salePriceMinor,
    pricingRole: input.pricingRole,
    pricingMultiplier: input.pricingMultiplier,
    provider: ORDER_PROVIDER,
    providerOrderId: null,
    providerStatus: null,
    refillSupported: input.refillSupported === true,
    cancelSupported: input.cancelSupported === true,
    status,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
}

export function pageOrders(records: OrderRecord[], page: number): OrderPage {
  const capped = records.slice(0, ORDERS_LIST_CAP);
  const pageCount = capped.length === 0 ? 0 : Math.ceil(capped.length / ORDERS_PAGE_SIZE);
  const start = (page - 1) * ORDERS_PAGE_SIZE;
  return {
    records: start >= capped.length ? [] : capped.slice(start, start + ORDERS_PAGE_SIZE),
    total: capped.length,
    page,
    pageCount,
  };
}

export function orderDocument(record: OrderRecord): Omit<OrderRecord, "id"> {
  return {
    userId: record.userId,
    serviceId: record.serviceId,
    serviceName: record.serviceName,
    category: record.category,
    targetUrl: record.targetUrl,
    quantity: record.quantity,
    currency: record.currency,
    salePriceMinor: record.salePriceMinor,
    pricingRole: record.pricingRole,
    pricingMultiplier: record.pricingMultiplier,
    provider: record.provider,
    providerOrderId: null,
    providerStatus: null,
    ...(typeof record.refillSupported === "boolean" ? { refillSupported: record.refillSupported } : {}),
    ...(typeof record.cancelSupported === "boolean" ? { cancelSupported: record.cancelSupported } : {}),
    status: record.status,
    idempotencyKey: record.idempotencyKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
