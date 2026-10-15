import { calculateOrderPrice } from "@/lib/pricing/calculate-order-price";

export const ORDER_CURRENCY = "TRY" as const;

export function totalPriceMinor(quantity: number, pricePerThousand: number): number | null {
  return calculateOrderPrice(quantity, pricePerThousand);
}

export function formatMinor(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) return "0.00";
  const major = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${major}.${fraction}`;
}

export function formatTry(minor: number): string {
  const label = formatMinor(minor);
  const match = /^(\d+)\.(\d{2})$/.exec(label);
  if (!match) return "0,00 TRY";
  const grouped = new Intl.NumberFormat("tr-TR").format(Number(match[1]));
  return `${grouped},${match[2]} TRY`;
}

export function formatTryLabel(minor: number): string {
  return formatTry(minor).replace(/ TRY$/, " TL");
}

export function formatSalePrice(salePrice: string): string {
  const match = /^(\d+)\.(\d{2})$/.exec(salePrice);
  if (!match) return salePrice;
  const grouped = new Intl.NumberFormat("tr-TR").format(Number(match[1]));
  return `${grouped},${match[2]} TRY`;
}
