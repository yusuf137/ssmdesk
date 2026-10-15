import type { PricingRole } from "@/lib/auth/roles";
import { TEXT_LIMITS } from "@/lib/constants";
import { AppError } from "@/lib/http/errors";
import { isViewerId } from "@/lib/orders/id";
import { ORDER_CURRENCY } from "@/lib/orders/money";
import { calculateOrderPrice } from "@/lib/pricing/calculate-order-price";
import { toPublicOrder, type PublicOrder } from "@/lib/orders/public-order";
import { ORDER_PROVIDER, type NewOrder, type OrderRecord } from "@/lib/orders/repository";
import { createOrderSchema } from "@/lib/orders/schema";

export type OrderServiceSnapshot = {
  id: number;
  name: string;
  category: string;
  salePrice: number;
  costPrice: number;
  min: number;
  max: number;
  pricingRole?: PricingRole;
  pricingMultiplier?: number | null;
  refill?: boolean;
  cancel?: boolean;
};

export async function placeOrder(args: {
  userId: string | null;
  body: unknown;
  findService: (serviceId: number) => Promise<OrderServiceSnapshot | null>;
  orders: {
    placePaidOrder(input: NewOrder): Promise<{ record: OrderRecord; created: boolean }>;
  };
}): Promise<{ order: PublicOrder; created: boolean }> {
  if (!args.userId || !isViewerId(args.userId)) {
    throw new AppError("UNAUTHENTICATED", 401, "Oturum doğrulanamadı.");
  }

  const parsed = createOrderSchema.safeParse(args.body);
  if (!parsed.success) throw parsed.error;

  const service = await args.findService(parsed.data.serviceId);
  if (!service || service.id !== parsed.data.serviceId) {
    throw new AppError("SERVICE_UNAVAILABLE", 400, "Hizmet bulunamadı veya siparişe kapalı.");
  }
  if (parsed.data.quantity < service.min) {
    throw new AppError("QUANTITY_TOO_LOW", 400, "Adet, hizmetin minimum değerinden küçük.");
  }
  if (parsed.data.quantity > service.max) {
    throw new AppError("QUANTITY_TOO_HIGH", 400, "Adet, hizmetin maksimum değerinden büyük.");
  }

  const salePriceMinor = calculateOrderPrice(parsed.data.quantity, service.salePrice);
  if (!Number.isFinite(service.costPrice) || service.costPrice < 0) {
    throw new AppError("PRICE_UNAVAILABLE", 400, "Bu hizmet için fiyat tanımlı değil.");
  }
  const providerCostMinor =
    service.costPrice === 0 ? 0 : calculateOrderPrice(parsed.data.quantity, service.costPrice);
  if (salePriceMinor === null || providerCostMinor === null) {
    throw new AppError("PRICE_UNAVAILABLE", 400, "Bu hizmet için fiyat tanımlı değil.");
  }

  const result = await args.orders.placePaidOrder({
    userId: args.userId,
    serviceId: service.id,
    serviceName: service.name.slice(0, TEXT_LIMITS.serviceName),
    category: service.category.slice(0, TEXT_LIMITS.category),
    targetUrl: parsed.data.targetUrl,
    quantity: parsed.data.quantity,
    currency: ORDER_CURRENCY,
    salePriceMinor,
    provider: ORDER_PROVIDER,
    idempotencyKey: parsed.data.idempotencyKey,
    providerCostMinor,
    pricingRole: service.pricingRole === "dealer" ? "dealer" : "user",
    pricingMultiplier:
      typeof service.pricingMultiplier === "number" && Number.isFinite(service.pricingMultiplier)
        ? service.pricingMultiplier
        : null,
    refillSupported: service.refill === true,
    cancelSupported: service.cancel === true,
  });

  return {
    order: toPublicOrder(result.record),
    created: result.created,
  };
}
