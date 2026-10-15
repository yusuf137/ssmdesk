import "server-only";

import type { UserRole } from "@/lib/auth/roles";
import { AppError } from "@/lib/http/errors";
import { logWarn } from "@/lib/logging/logger";
import { loadPricingSnapshot, priceForRole } from "@/lib/pricing/firestore-config";
import {
  publicCatalogSchema,
  publicServiceSchema,
  toPublicService,
  type PublicService,
} from "@/lib/services/public-service";
import { getSmmProvider } from "@/lib/smm";

export type OrderableService = PublicService & {
  costPrice: number;
  pricingRole: "user" | "dealer";
  pricingMultiplier: number | null;
};

async function loadPricedServices(role: UserRole): Promise<OrderableService[]> {
  let pricing;
  try {
    pricing = await loadPricingSnapshot();
  } catch (error) {
    if (error instanceof AppError) throw error;
    logWarn("pricing_config_unreadable", { result: "failure" });
    throw new AppError("CATALOG_UNAVAILABLE", 503, "Hizmet listesi alınamadı.", "pricing_config_unreadable");
  }
  const providerServices = await getSmmProvider().getServices();
  const services: OrderableService[] = [];
  let pricingFallbacks = 0;
  for (const service of providerServices) {
    let priced;
    try {
      priced = priceForRole(pricing, role, {
        costPrice: service.costPrice,
        category: service.category,
        serviceId: service.id,
      });
    } catch {
      priced = null;
    }
    if (!priced) {
      pricingFallbacks += 1;
      continue;
    }

    const rawType = typeof service.type === "string" ? service.type.trim() : "";
    const serviceType = rawType || "Standart";
    const parsed = publicServiceSchema.safeParse(
      toPublicService({
        id: service.id,
        name: service.name,
        category: service.category,
        type: serviceType,
        salePrice: priced.salePrice,
        min: service.min,
        max: service.max,
        refill: service.refill,
        cancel: service.cancel,
      }),
    );
    if (!parsed.success) continue;
    services.push({
      ...parsed.data,
      costPrice: service.costPrice,
      pricingRole: priced.pricingRole,
      pricingMultiplier: priced.multiplier,
    });
  }

  if (pricingFallbacks > 0) {
    logWarn("SERVICE_PRICING_FALLBACK", { dropped: pricingFallbacks, kept: services.length });
  }
  if (services.length === 0 && providerServices.length > 0) {
    throw new AppError("CATALOG_UNAVAILABLE", 503, "Hizmet listesi alınamadı.", "pricing_failed");
  }

  return services;
}

export async function getPublicCatalog(role: UserRole): Promise<PublicService[]> {
  const services = (await loadPricedServices(role)).map((service) => toPublicService(service));
  const catalog = publicCatalogSchema.safeParse({ services });
  if (!catalog.success) {
    throw new AppError("CATALOG_UNAVAILABLE", 503, "Hizmet listesi alınamadı.", "public_catalog_shape");
  }
  return catalog.data.services;
}

export async function getOrderableService(serviceId: number, role: UserRole): Promise<OrderableService | null> {
  const services = await loadPricedServices(role);
  return services.find((service) => service.id === serviceId) ?? null;
}
