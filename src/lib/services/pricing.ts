import { PRICE_SCALE } from "@/lib/constants";

export function roundPrice(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * PRICE_SCALE) / PRICE_SCALE;
}

export function resolveSalePrice(
  costPrice: number,
  multiplier: number,
  overrideSalePrice: number | null,
): number | null {
  if (overrideSalePrice !== null) {
    if (!Number.isFinite(overrideSalePrice) || overrideSalePrice <= 0) return null;
    return roundPrice(overrideSalePrice);
  }

  if (!Number.isFinite(costPrice) || costPrice < 0) return null;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  return roundPrice(costPrice * multiplier);
}
