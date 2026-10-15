import { z } from "zod";

import { REFILL_STATUS_CACHE_MS } from "@/lib/constants";
import { AppError } from "@/lib/http/errors";
import type { OrderStatus } from "@/lib/orders/status";

export const CANCEL_STATUSES = [
  "requested",
  "submitting",
  "processing",
  "accepted",
  "pending_settlement",
  "rejected",
  "completed",
  "unknown",
] as const;

export type CancelStatus = (typeof CANCEL_STATUSES)[number];

export const ACTIVE_CANCEL_STATUSES = ["requested", "submitting", "processing", "accepted", "pending_settlement", "unknown"] as const;

export const CANCEL_ELIGIBLE_ORDER_STATUSES = ["in_progress", "partial"] as const;

export const ADMIN_CANCEL_FILTERS = ["processing", "accepted", "rejected", "unknown", "pending_settlement", "completed"] as const;

export type AdminCancelFilter = (typeof ADMIN_CANCEL_FILTERS)[number];

export type CancelBlockCode = "not_owner" | "missing_provider_order" | "cancel_not_supported" | "not_eligible" | "active_cancel_exists";

export type CancelRejectCode = "not_eligible" | "cancel_not_supported" | "already_completed" | "active_cancel_exists";

const LABELS: Record<CancelStatus, string> = {
  requested: "İptal Talep Edildi",
  submitting: "İptal İşleniyor",
  processing: "İptal İşleniyor",
  accepted: "İptal İşleniyor",
  pending_settlement: "İade Hesaplanıyor",
  rejected: "Reddedildi",
  completed: "İptal Edildi",
  unknown: "Kontrol Gerekiyor",
};

export type CancelRecord = {
  id: string;
  userId: string;
  orderId: string;
  provider: "smmfull";
  providerOrderId: string;
  status: CancelStatus;
  previousOrderStatus: "in_progress" | "partial";
  requestedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  lastCheckedAt: string | null;
  internalErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export const publicCancelSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    orderId: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(CANCEL_STATUSES),
    requestedAt: z.string().min(1).max(40),
    completedAt: z.string().min(1).max(40).nullable(),
    rejectedAt: z.string().min(1).max(40).nullable(),
  })
  .strict();

export type PublicCancel = z.infer<typeof publicCancelSchema>;

export const cancelRequestSchema = z.object({}).strict();

export function isCancelStatus(value: unknown): value is CancelStatus {
  return typeof value === "string" && CANCEL_STATUSES.some((status) => status === value);
}

export function isActiveCancelStatus(status: CancelStatus): boolean {
  return ACTIVE_CANCEL_STATUSES.some((item) => item === status);
}

export function isAdminCancelFilter(value: string): value is AdminCancelFilter {
  return ADMIN_CANCEL_FILTERS.some((status) => status === value);
}

export function cancelStatusLabel(status: CancelStatus): string {
  return LABELS[status];
}

export function cancelBlockMessage(code: CancelBlockCode): string {
  if (code === "not_owner") return "Sipariş bulunamadı.";
  if (code === "cancel_not_supported") return "Bu hizmet iptal desteklemiyor.";
  if (code === "active_cancel_exists") return "Bu sipariş için açık bir iptal talebi var.";
  return "Bu sipariş iptal için uygun değil.";
}

export function decideCancelEligibility(input: {
  owner: boolean;
  providerOrderId: string | null;
  cancelSupported: boolean | null;
  orderStatus: OrderStatus | null;
  activeStatus: CancelStatus | null;
}): { ok: true } | { ok: false; code: CancelBlockCode } {
  if (!input.owner) return { ok: false, code: "not_owner" };
  if (input.activeStatus && isActiveCancelStatus(input.activeStatus)) return { ok: false, code: "active_cancel_exists" };
  if (!input.providerOrderId) return { ok: false, code: "missing_provider_order" };
  if (input.cancelSupported !== true) return { ok: false, code: "cancel_not_supported" };
  if (!input.orderStatus || !CANCEL_ELIGIBLE_ORDER_STATUSES.some((status) => status === input.orderStatus)) {
    return { ok: false, code: "not_eligible" };
  }
  return { ok: true };
}

export function normalizeCancelReject(providerMessage: string): CancelRejectCode {
  const text = providerMessage.toLowerCase();
  if (/support|unavailable|not available|disabled/.test(text)) return "cancel_not_supported";
  if (/completed|complete/.test(text)) return "already_completed";
  if (/already|in progress|active|duplicate/.test(text)) return "active_cancel_exists";
  return "not_eligible";
}

export function normalizeProviderOrderStatus(value: string): "pending" | "completed" | "partial" | "cancelled" | "unknown" {
  const status = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["pending", "processing", "in_progress", "inprogress", "progress", "awaiting"].includes(status)) return "pending";
  if (["completed", "complete", "success"].includes(status)) return "completed";
  if (status === "partial") return "partial";
  if (["canceled", "cancelled", "cancel"].includes(status)) return "cancelled";
  return "unknown";
}

export type SettlementDecision =
  | { kind: "wait" }
  | { kind: "close"; refundMinor: 0; orderStatus: "completed" | "partial" | "cancelled" }
  | { kind: "refund"; amountMinor: number; orderStatus: "refunded" | "cancelled" };

export function customerRefundMinor(salePriceMinor: number, quantity: number, remains: number): number | null {
  if (!Number.isSafeInteger(salePriceMinor) || salePriceMinor <= 0) return null;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
  if (!Number.isSafeInteger(remains) || remains < 0 || remains > quantity) return null;
  const whole = Math.floor(salePriceMinor / quantity) * remains;
  const extra = Math.floor(((salePriceMinor % quantity) * remains) / quantity);
  const amount = whole + extra;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > salePriceMinor) return null;
  return amount;
}

export function decideCancelSettlement(input: {
  salePriceMinor: number;
  quantity: number;
  remains: number | null;
  providerStatus: string;
}): SettlementDecision {
  const status = normalizeProviderOrderStatus(input.providerStatus);
  if (status === "pending" || status === "unknown") return { kind: "wait" };
  if (status === "completed") return { kind: "close", refundMinor: 0, orderStatus: "completed" };
  const remainsKnown =
    typeof input.remains === "number" && Number.isSafeInteger(input.remains) && input.remains >= 0 && input.remains <= input.quantity;
  if (!remainsKnown) return { kind: "wait" };
  const remains = input.remains as number;
  if (remains === 0) {
    return { kind: "close", refundMinor: 0, orderStatus: status === "partial" ? "partial" : "cancelled" };
  }
  const amount = customerRefundMinor(input.salePriceMinor, input.quantity, remains);
  if (amount === null) return { kind: "wait" };
  if (amount === 0) {
    return { kind: "close", refundMinor: 0, orderStatus: status === "partial" ? "partial" : "cancelled" };
  }
  if (amount === input.salePriceMinor) return { kind: "refund", amountMinor: amount, orderStatus: "refunded" };
  return { kind: "refund", amountMinor: amount, orderStatus: "cancelled" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function interpretCancelPayload(
  payload: unknown,
  providerOrderId: string,
): { outcome: "accepted" } | { outcome: "rejected"; code: CancelRejectCode } | { outcome: "unknown" } {
  const rows = Array.isArray(payload) ? payload : isRecord(payload) ? [payload] : null;
  if (!rows) return { outcome: "unknown" };
  const match = rows.find((row) => {
    if (!isRecord(row)) return false;
    if (row.order === undefined) return rows.length === 1;
    return String(row.order) === providerOrderId;
  });
  if (!match || !isRecord(match) || !("cancel" in match)) return { outcome: "unknown" };
  const cancel = match.cancel;
  if (cancel === 1 || cancel === "1") return { outcome: "accepted" };
  if (isRecord(cancel) && typeof cancel.error === "string") {
    return { outcome: "rejected", code: normalizeCancelReject(cancel.error) };
  }
  return { outcome: "unknown" };
}

export function toPublicCancel(record: CancelRecord): PublicCancel {
  return {
    id: record.id,
    orderId: record.orderId,
    status: record.status,
    requestedAt: record.requestedAt,
    completedAt: record.completedAt,
    rejectedAt: record.rejectedAt,
  };
}

export function decideCancelSync(input: {
  status: CancelStatus;
  lastCheckedAt: string | null;
  nowMs: number;
  force: boolean;
}): "skip" | "check" {
  if (input.status === "rejected" || input.status === "completed" || input.status === "submitting" || input.status === "requested") {
    return "skip";
  }
  if (!input.force && input.lastCheckedAt) {
    const checkedMs = Date.parse(input.lastCheckedAt);
    if (Number.isFinite(checkedMs) && input.nowMs - checkedMs < REFILL_STATUS_CACHE_MS) return "skip";
  }
  return "check";
}

export type CancelClaim =
  | { kind: "duplicate"; cancel: CancelRecord }
  | { kind: "blocked"; code: CancelBlockCode }
  | { kind: "claimed"; cancel: CancelRecord; providerOrderId: string };

export type CancelRunResult =
  | { kind: "duplicate"; cancel: CancelRecord }
  | { kind: "blocked"; code: CancelBlockCode }
  | { kind: "accepted"; cancel: CancelRecord }
  | { kind: "rejected"; cancel: CancelRecord }
  | { kind: "unknown"; cancel: CancelRecord };

export async function runCancelRequest(ports: {
  claim(): Promise<CancelClaim>;
  requestCancel(providerOrderId: string): Promise<{ accepted: true }>;
  markAccepted(id: string, now: string): Promise<CancelRecord>;
  markRejected(id: string, code: CancelRejectCode, now: string): Promise<CancelRecord>;
  markUnknown(id: string, code: string, now: string): Promise<CancelRecord>;
  onEvent(action: string, metadata: Record<string, string | boolean>): void;
  now: string;
}): Promise<CancelRunResult> {
  const claimed = await ports.claim();
  if (claimed.kind === "duplicate") {
    ports.onEvent("CANCEL_DUPLICATE_BLOCKED", { orderId: claimed.cancel.orderId, cancelRequestId: claimed.cancel.id });
    return claimed;
  }
  if (claimed.kind === "blocked") return claimed;
  ports.onEvent("CANCEL_REQUESTED", { orderId: claimed.cancel.orderId, cancelRequestId: claimed.cancel.id });
  try {
    await ports.requestCancel(claimed.providerOrderId);
    const cancel = await ports.markAccepted(claimed.cancel.id, ports.now);
    ports.onEvent("CANCEL_SUBMITTED", { orderId: cancel.orderId, cancelRequestId: cancel.id });
    return { kind: "accepted", cancel };
  } catch (error) {
    if (error instanceof AppError && error.code === "PROVIDER_REJECTED") {
      const code = normalizeCancelReject(error.internalMessage ?? "");
      const cancel = await ports.markRejected(claimed.cancel.id, code, ports.now);
      ports.onEvent("CANCEL_REJECTED", { orderId: cancel.orderId, cancelRequestId: cancel.id, code });
      return { kind: "rejected", cancel };
    }
    const cancel = await ports.markUnknown(claimed.cancel.id, "provider_unavailable", ports.now);
    ports.onEvent("CANCEL_UNKNOWN", { orderId: cancel.orderId, cancelRequestId: cancel.id, code: "provider_unavailable" });
    return { kind: "unknown", cancel };
  }
}
