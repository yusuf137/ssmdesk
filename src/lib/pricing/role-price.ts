import { roundPrice } from "@/lib/services/pricing";
import type { PricingRole } from "@/lib/auth/roles";

export type RoleMultiplierConfig = {
  userMultiplier: number;
  dealerMultiplier: number;
  minimumProfitMinor: number;
};

export type CategoryRoleMultiplier = {
  userMultiplier: number | null;
  dealerMultiplier: number | null;
};

export type ServiceRoleOverride = {
  enabled: boolean;
  fixedSalePrice: number | null;
  userFixedRateMinor: number | null;
  dealerFixedRateMinor: number | null;
  userMultiplier: number | null;
  dealerMultiplier: number | null;
};

export type ResolvedRolePrice = {
  salePrice: number;
  multiplier: number | null;
  pricingRole: PricingRole;
};

function multiplierFor(role: PricingRole, userValue: number | null, dealerValue: number | null): number | null {
  const value = role === "dealer" ? dealerValue : userValue;
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function fixedMinorFor(role: PricingRole, override: ServiceRoleOverride): number | null {
  const value = role === "dealer" ? override.dealerFixedRateMinor : override.userFixedRateMinor;
  if (value === null || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function priceFromMultiplier(costPrice: number, multiplier: number): number | null {
  return roundPrice(costPrice * multiplier);
}

function applyMinimumProfit(salePrice: number, costPrice: number, minimumProfitMinor: number): number | null {
  if (!Number.isSafeInteger(minimumProfitMinor) || minimumProfitMinor < 0) return null;
  const saleMinor = Math.round(salePrice * 100);
  const costMinor = Math.round(costPrice * 100);
  if (!Number.isSafeInteger(saleMinor) || !Number.isSafeInteger(costMinor)) return null;
  const floor = costMinor + minimumProfitMinor;
  if (!Number.isSafeInteger(floor)) return null;
  if (saleMinor >= floor) return salePrice;
  return roundPrice(floor / 100);
}

export function resolveRolePrice(input: {
  role: PricingRole;
  costPrice: number;
  fallbackMultiplier: number;
  global: RoleMultiplierConfig;
  service: ServiceRoleOverride | null;
  category: CategoryRoleMultiplier | null;
}): ResolvedRolePrice | null {
  if (!Number.isFinite(input.costPrice) || input.costPrice < 0) return null;
  const service = input.service;
  let salePrice: number | null = null;
  let multiplier: number | null = null;

  const roleFixed = service?.enabled ? fixedMinorFor(input.role, service) : null;
  if (roleFixed !== null) {
    salePrice = roundPrice(roleFixed / 100);
    multiplier = input.costPrice > 0 && salePrice !== null ? salePrice / input.costPrice : null;
  } else if (service?.enabled && service.fixedSalePrice !== null) {
    salePrice = roundPrice(service.fixedSalePrice);
    multiplier = input.costPrice > 0 && salePrice !== null ? salePrice / input.costPrice : null;
  } else {
    const serviceMultiplier = service?.enabled
      ? multiplierFor(input.role, service.userMultiplier, service.dealerMultiplier)
      : null;
    const categoryMultiplier = multiplierFor(
      input.role,
      input.category?.userMultiplier ?? null,
      input.category?.dealerMultiplier ?? null,
    );
    const globalMultiplier = multiplierFor(input.role, input.global.userMultiplier, input.global.dealerMultiplier);
    multiplier =
      serviceMultiplier ??
      categoryMultiplier ??
      globalMultiplier ??
      (Number.isFinite(input.fallbackMultiplier) && input.fallbackMultiplier > 0 ? input.fallbackMultiplier : null);
    if (multiplier === null) return null;
    salePrice = priceFromMultiplier(input.costPrice, multiplier);
  }

  if (salePrice === null || salePrice <= 0) return null;
  const guarded = applyMinimumProfit(salePrice, input.costPrice, input.global.minimumProfitMinor);
  if (guarded === null || guarded <= 0) return null;
  return { salePrice: guarded, multiplier, pricingRole: input.role };
}
