import { PRICE_SCALE } from "@/lib/constants";

const MINOR_PER_MAJOR = BigInt(100);
const PER_THOUSAND = BigInt(1000);

export function calculateOrderPrice(quantity: number, saleRatePerThousand: number): number | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(saleRatePerThousand) || saleRatePerThousand <= 0) return null;

  const scaled = Math.round(saleRatePerThousand * PRICE_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) return null;

  const numerator = BigInt(quantity) * BigInt(scaled) * MINOR_PER_MAJOR;
  const denominator = PER_THOUSAND * BigInt(PRICE_SCALE);
  const minor = (numerator + denominator / BigInt(2)) / denominator;
  if (minor <= BigInt(0) || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}
