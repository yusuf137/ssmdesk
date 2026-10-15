import type { OrderStatus } from "@/lib/orders/status";

export const ADMIN_ORDER_FILTERS = [
  "paid",
  "checking_provider_balance",
  "awaiting_provider_funds",
  "submitting",
  "submission_unknown",
  "in_progress",
  "failed",
  "refunded",
] as const;

export type AdminOrderFilter = (typeof ADMIN_ORDER_FILTERS)[number];

const CLAIMABLE = new Set<OrderStatus>(["paid", "checking_provider_balance", "awaiting_provider_funds"]);

export type SubmitClaimDecision = "claim" | "duplicate" | "blocked";

export function isAdminOrderFilter(value: string): value is AdminOrderFilter {
  return ADMIN_ORDER_FILTERS.some((status) => status === value);
}

export function normalizeProviderCurrency(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  return currency === "TL" ? "TRY" : currency;
}

export function compareProviderFunds(input: {
  costCurrency: string | null;
  balanceCurrency: string | null;
  costMinor: number;
  balanceMinor: number;
}): "ok" | "insufficient" | "mismatch" {
  const balanceCurrency = normalizeProviderCurrency(input.balanceCurrency);
  const costCurrency = normalizeProviderCurrency(input.costCurrency);
  if (!balanceCurrency) return "mismatch";
  if (costCurrency && costCurrency !== balanceCurrency) return "mismatch";
  if (!Number.isSafeInteger(input.costMinor) || input.costMinor < 0) return "mismatch";
  if (!Number.isSafeInteger(input.balanceMinor) || input.balanceMinor < 0) return "mismatch";
  return input.balanceMinor >= input.costMinor ? "ok" : "insufficient";
}

export function decideProviderSubmitClaim(input: {
  status: OrderStatus | null;
  providerOrderId: string | null;
  allowUnknownRetry: boolean;
}): SubmitClaimDecision {
  if (!input.status) return "blocked";
  if (input.providerOrderId) return "duplicate";
  if (input.status === "refunded" || input.status === "failed" || input.status === "in_progress") return "blocked";
  if (
    input.status === "completed" ||
    input.status === "partial" ||
    input.status === "cancelled" ||
    input.status === "cancel_requested" ||
    input.status === "cancel_processing" ||
    input.status === "cancel_pending_settlement"
  ) {
    return "blocked";
  }
  if (input.status === "submission_unknown" || input.status === "submitting") {
    return input.allowUnknownRetry ? "claim" : input.status === "submitting" ? "duplicate" : "blocked";
  }
  if (input.status === "pending_payment") return "blocked";
  return CLAIMABLE.has(input.status) ? "claim" : "blocked";
}

export type ProviderFailureKind = "insufficient_balance" | "definitive_reject" | "ambiguous";

export function classifyProviderFailure(input: { code?: string; detail?: string }): ProviderFailureKind {
  const detail = (input.detail ?? "").toLowerCase();
  if (detail.includes("provider_order_id_missing") || detail.includes("provider_invalid_json")) return "ambiguous";
  if (detail.includes("provider_network") || detail.includes("provider_body_too_large")) return "ambiguous";
  if (/provider_http_5\d\d/.test(detail) || detail.includes("provider_http_408") || detail.includes("provider_http_429")) {
    return "ambiguous";
  }
  if (input.code === "PROVIDER_UNAVAILABLE") return "ambiguous";
  if (detail.includes("not enough funds") || detail.includes("insufficient") || detail.includes("balance is insufficient")) {
    return "insufficient_balance";
  }
  if (input.code === "PROVIDER_REJECTED") return "definitive_reject";
  return "ambiguous";
}

export type SubmissionSnapshot = {
  status: OrderStatus;
  userId: string;
  serviceId: number;
  targetUrl: string;
  quantity: number;
  salePriceMinor: number;
  providerCostMinor: number;
  providerCurrency: string | null;
  providerOrderId: string | null;
  submissionAttemptId: string | null;
  submissionAttemptCount: number;
};

export type SubmissionPorts = {
  claim(attemptId: string, now: string): Promise<{ ok: true; snapshot: SubmissionSnapshot } | { ok: false; reason: "duplicate" | "blocked" }>;
  rememberCurrency(attemptId: string, currency: string): Promise<boolean>;
  markAwaiting(attemptId: string, now: string): Promise<void>;
  release(attemptId: string, now: string): Promise<void>;
  markUnknown(attemptId: string, now: string, errorCode: string): Promise<void>;
  markRejected(attemptId: string, now: string, errorCode: string): Promise<boolean>;
  markSubmitted(attemptId: string, now: string, providerOrderId: string): Promise<boolean>;
  getBalance(): Promise<{ balanceMinor: number; currency: string | null }>;
  createOrder(input: { serviceId: number; targetUrl: string; quantity: number }): Promise<{ providerOrderId: string }>;
  refund(orderId: string): Promise<"refunded" | "duplicate" | "not_refundable" | "missing">;
};

export type SubmissionResult = "in_progress" | "awaiting_provider_funds" | "submission_unknown" | "refunded" | "duplicate" | "blocked" | "currency_mismatch";

function margin(snapshot: SubmissionSnapshot): number | null {
  if (!Number.isSafeInteger(snapshot.salePriceMinor) || !Number.isSafeInteger(snapshot.providerCostMinor)) return null;
  const value = snapshot.salePriceMinor - snapshot.providerCostMinor;
  return Number.isSafeInteger(value) ? value : null;
}

export async function runProviderSubmission(input: {
  orderId: string;
  allowUnknownRetry: boolean;
  now: string;
  attemptId: string;
  ports: SubmissionPorts;
  onEvent?: (action: string, metadata: Record<string, string | number | boolean>) => void;
}): Promise<SubmissionResult> {
  const claimed = await input.ports.claim(input.attemptId, input.now);
  if (!claimed.ok) return claimed.reason;
  const snapshot = claimed.snapshot;
  const storedMargin = margin(snapshot);
  input.onEvent?.("PROVIDER_ORDER_SUBMIT_STARTED", {
    orderId: input.orderId,
    attempt: snapshot.submissionAttemptCount,
    ...(storedMargin === null ? {} : { marginMinor: storedMargin }),
  });

  let balance: { balanceMinor: number; currency: string | null };
  try {
    balance = await input.ports.getBalance();
  } catch {
    await input.ports.release(input.attemptId, input.now);
    input.onEvent?.("PROVIDER_BALANCE_CHECKED", { orderId: input.orderId, errorCode: "balance_unreachable" });
    return "blocked";
  }

  const funds = compareProviderFunds({
    costCurrency: snapshot.providerCurrency,
    balanceCurrency: balance.currency,
    costMinor: snapshot.providerCostMinor,
    balanceMinor: balance.balanceMinor,
  });
  input.onEvent?.("PROVIDER_BALANCE_CHECKED", {
    orderId: input.orderId,
    balanceMinor: balance.balanceMinor,
    currency: normalizeProviderCurrency(balance.currency) ?? "",
  });

  if (funds === "mismatch") {
    await input.ports.markUnknown(input.attemptId, input.now, "PROVIDER_CURRENCY_MISMATCH");
    input.onEvent?.("PROVIDER_CURRENCY_MISMATCH", { orderId: input.orderId });
    return "currency_mismatch";
  }

  const currency = normalizeProviderCurrency(balance.currency);
  if (!snapshot.providerCurrency && currency) {
    const remembered = await input.ports.rememberCurrency(input.attemptId, currency);
    if (!remembered) return "duplicate";
  }

  if (funds === "insufficient") {
    await input.ports.markAwaiting(input.attemptId, input.now);
    input.onEvent?.("PROVIDER_ORDER_WAITING_FUNDS", {
      orderId: input.orderId,
      providerCostMinor: snapshot.providerCostMinor,
      balanceMinor: balance.balanceMinor,
    });
    return "awaiting_provider_funds";
  }

  try {
    const created = await input.ports.createOrder({
      serviceId: snapshot.serviceId,
      targetUrl: snapshot.targetUrl,
      quantity: snapshot.quantity,
    });
    const saved = await input.ports.markSubmitted(input.attemptId, input.now, created.providerOrderId);
    if (!saved) return "duplicate";
    input.onEvent?.("PROVIDER_ORDER_SUBMITTED", { orderId: input.orderId });
    return "in_progress";
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
    const detail = error instanceof Error && "internalMessage" in error && typeof error.internalMessage === "string" ? error.internalMessage : "";
    const kind = classifyProviderFailure({ code, detail });
    if (kind === "insufficient_balance") {
      await input.ports.markAwaiting(input.attemptId, input.now);
      input.onEvent?.("PROVIDER_ORDER_REJECTED", { orderId: input.orderId, errorCode: "insufficient_provider_balance" });
      input.onEvent?.("PROVIDER_ORDER_WAITING_FUNDS", { orderId: input.orderId });
      return "awaiting_provider_funds";
    }
    if (kind === "definitive_reject") {
      const rejected = await input.ports.markRejected(input.attemptId, input.now, "provider_rejected");
      if (!rejected) return "duplicate";
      const refund = await input.ports.refund(input.orderId);
      input.onEvent?.("PROVIDER_ORDER_REJECTED", { orderId: input.orderId, errorCode: "provider_rejected" });
      if (refund === "refunded" || refund === "duplicate") {
        input.onEvent?.("PROVIDER_ORDER_REFUNDED", { orderId: input.orderId });
        return "refunded";
      }
      return "refunded";
    }
    await input.ports.markUnknown(input.attemptId, input.now, "provider_unknown");
    input.onEvent?.("PROVIDER_ORDER_UNKNOWN", { orderId: input.orderId, errorCode: "provider_unknown" });
    return "submission_unknown";
  }
}
