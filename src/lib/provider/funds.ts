import type { OrderStatus } from "@/lib/orders/status";

const REVIEWABLE = new Set<OrderStatus>(["paid", "checking_provider_balance", "awaiting_provider_funds"]);

export type ProviderFundsDecision = "submitting" | "awaiting_provider_funds";

export function canReviewProviderFunds(status: OrderStatus): boolean {
  return REVIEWABLE.has(status);
}

export function decideProviderFunds(input: {
  status: OrderStatus;
  providerCostMinor: number;
  providerBalanceMinor: number;
}): ProviderFundsDecision | null {
  if (!canReviewProviderFunds(input.status)) return null;
  if (!Number.isSafeInteger(input.providerCostMinor) || input.providerCostMinor < 0) return null;
  if (!Number.isSafeInteger(input.providerBalanceMinor) || input.providerBalanceMinor < 0) return null;
  return input.providerBalanceMinor >= input.providerCostMinor ? "submitting" : "awaiting_provider_funds";
}
