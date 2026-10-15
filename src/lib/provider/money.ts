export type ProviderBalanceLevel = "normal" | "low" | "critical";

export function decimalToMinor(raw: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,8}))?$/.exec(raw.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const digits = match[2] ?? "";
  const fraction = Number((digits + "00").slice(0, 2));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  let minor = whole * 100 + fraction;
  if ((digits[2] ?? "0") >= "5") minor += 1;
  return Number.isSafeInteger(minor) ? minor : null;
}

export function parseProviderRate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function providerAmountToMinor(value: unknown): number | null {
  if (typeof value === "string") return decimalToMinor(value);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return decimalToMinor(value.toFixed(8));
  }
  return null;
}

export function providerBalanceLevel(balanceMinor: number, thresholdMinor: number): ProviderBalanceLevel {
  if (!Number.isSafeInteger(balanceMinor) || balanceMinor <= 0) return "critical";
  if (!Number.isSafeInteger(thresholdMinor) || thresholdMinor <= 0) return "normal";
  if (balanceMinor * 2 < thresholdMinor) return "critical";
  if (balanceMinor < thresholdMinor) return "low";
  return "normal";
}
