import { z } from "zod";

import { REFILL_COOLDOWN_HOURS_DEFAULT, REFILL_STATUS_CACHE_MS } from "@/lib/constants";
import { AppError } from "@/lib/http/errors";
import type { OrderStatus } from "@/lib/orders/status";

export const REFILL_STATUSES = [
  "requested",
  "submitting",
  "processing",
  "completed",
  "rejected",
  "failed",
  "unknown",
] as const;

export type RefillStatus = (typeof REFILL_STATUSES)[number];

export const ACTIVE_REFILL_STATUSES = ["requested", "submitting", "processing", "unknown"] as const;

export const REFILL_ELIGIBLE_ORDER_STATUSES = ["in_progress", "completed", "partial"] as const;

export const ADMIN_REFILL_FILTERS = ["processing", "rejected", "unknown", "completed"] as const;

export type AdminRefillFilter = (typeof ADMIN_REFILL_FILTERS)[number];

export type RefillBlockCode =
  | "not_owner"
  | "missing_provider_order"
  | "refill_not_supported"
  | "not_eligible"
  | "cooldown"
  | "active_refill_exists";

export type RefillRejectCode = "not_eligible" | "refill_not_supported" | "refill_period_expired" | "active_refill_exists";

const LABELS: Record<RefillStatus, string> = {
  requested: "Talep Alındı",
  submitting: "Sağlayıcıya Gönderiliyor",
  processing: "İşleniyor",
  completed: "Tamamlandı",
  rejected: "Reddedildi",
  failed: "Başarısız",
  unknown: "Kontrol Gerekiyor",
};

export type RefillRecord = {
  id: string;
  userId: string;
  orderId: string;
  provider: "smmfull";
  providerOrderId: string;
  providerRefillId: string | null;
  status: RefillStatus;
  requestedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  lastCheckedAt: string | null;
  providerStatus: string | null;
  internalErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export const publicRefillSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    orderId: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(REFILL_STATUSES),
    requestedAt: z.string().min(1).max(40),
    completedAt: z.string().min(1).max(40).nullable(),
    rejectedAt: z.string().min(1).max(40).nullable(),
  })
  .strict();

export type PublicRefill = z.infer<typeof publicRefillSchema>;

export const refillRequestSchema = z.object({}).strict();

export function isRefillStatus(value: unknown): value is RefillStatus {
  return typeof value === "string" && REFILL_STATUSES.some((status) => status === value);
}

export function isActiveRefillStatus(status: RefillStatus): boolean {
  return ACTIVE_REFILL_STATUSES.some((item) => item === status);
}

export function isAdminRefillFilter(value: string): value is AdminRefillFilter {
  return ADMIN_REFILL_FILTERS.some((status) => status === value);
}

export function refillStatusLabel(status: RefillStatus): string {
  return LABELS[status];
}

export function refillCooldownMs(envValue: string | undefined = process.env.REFILL_COOLDOWN_HOURS): number {
  const fallback = REFILL_COOLDOWN_HOURS_DEFAULT * 60 * 60 * 1000;
  if (envValue === undefined || envValue.trim() === "") return fallback;
  if (!/^\d{1,4}$/.test(envValue.trim())) return fallback;
  const hours = Number(envValue);
  if (hours > 24 * 30) return fallback;
  return hours * 60 * 60 * 1000;
}

export function refillBlockMessage(code: RefillBlockCode): string {
  if (code === "not_owner") return "Sipariş bulunamadı.";
  if (code === "refill_not_supported") return "Bu hizmet refill desteklemiyor.";
  if (code === "cooldown") return "Bu sipariş için yeniden refill talebi henüz açılamaz.";
  if (code === "active_refill_exists") return "Bu sipariş için açık bir refill talebi var.";
  return "Bu sipariş refill için uygun değil.";
}

export function decideRefillEligibility(input: {
  owner: boolean;
  providerOrderId: string | null;
  refillSupported: boolean | null;
  orderStatus: OrderStatus | null;
  activeStatus: RefillStatus | null;
  lastTerminalAt: string | null;
  nowMs: number;
  cooldownMs: number;
}): { ok: true } | { ok: false; code: RefillBlockCode } {
  if (!input.owner) return { ok: false, code: "not_owner" };
  if (input.activeStatus && isActiveRefillStatus(input.activeStatus)) {
    return { ok: false, code: "active_refill_exists" };
  }
  if (!input.providerOrderId) return { ok: false, code: "missing_provider_order" };
  if (input.refillSupported !== true) return { ok: false, code: "refill_not_supported" };
  if (!input.orderStatus || !REFILL_ELIGIBLE_ORDER_STATUSES.some((status) => status === input.orderStatus)) {
    return { ok: false, code: "not_eligible" };
  }
  if (input.lastTerminalAt) {
    const terminalMs = Date.parse(input.lastTerminalAt);
    if (Number.isFinite(terminalMs) && input.nowMs - terminalMs < input.cooldownMs) {
      return { ok: false, code: "cooldown" };
    }
  }
  return { ok: true };
}

export function normalizeRefillReject(providerMessage: string): RefillRejectCode {
  const text = providerMessage.toLowerCase();
  if (/support|unavailable|not available|disabled/.test(text)) return "refill_not_supported";
  if (/expir/.test(text)) return "refill_period_expired";
  if (/already|in progress|active refill|duplicate/.test(text)) return "active_refill_exists";
  return "not_eligible";
}

export function mapProviderRefillStatus(value: string): "processing" | "completed" | "rejected" | "unknown" {
  const status = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["pending", "processing", "in_progress", "inprogress", "progress", "awaiting"].includes(status)) return "processing";
  if (["completed", "complete", "success"].includes(status)) return "completed";
  if (["rejected", "reject", "cancelled", "canceled", "failed", "error"].includes(status)) return "rejected";
  if (status === "partial") return "processing";
  return "unknown";
}

export function toPublicRefill(record: RefillRecord): PublicRefill {
  return {
    id: record.id,
    orderId: record.orderId,
    status: record.status,
    requestedAt: record.requestedAt,
    completedAt: record.completedAt,
    rejectedAt: record.rejectedAt,
  };
}

export function decideRefillSync(input: {
  status: RefillStatus;
  providerRefillId: string | null;
  lastCheckedAt: string | null;
  nowMs: number;
  force: boolean;
}): "skip" | "check" {
  if (!input.providerRefillId) return "skip";
  if (input.status === "completed" || input.status === "rejected" || input.status === "failed") return "skip";
  if (!input.force && input.lastCheckedAt) {
    const checkedMs = Date.parse(input.lastCheckedAt);
    if (Number.isFinite(checkedMs) && input.nowMs - checkedMs < REFILL_STATUS_CACHE_MS) return "skip";
  }
  return "check";
}

export function applyMappedRefillStatus(record: RefillRecord, mapped: "processing" | "completed" | "rejected" | "unknown", now: string): {
  refill: RefillRecord;
  releaseActive: boolean;
} {
  const next: RefillRecord = {
    ...record,
    status: mapped,
    providerStatus: mapped,
    lastCheckedAt: now,
    updatedAt: now,
    internalErrorCode: mapped === "rejected" ? record.internalErrorCode ?? "not_eligible" : null,
    completedAt: mapped === "completed" ? record.completedAt ?? now : record.completedAt,
    rejectedAt: mapped === "rejected" ? record.rejectedAt ?? now : record.rejectedAt,
  };
  return { refill: next, releaseActive: mapped === "completed" || mapped === "rejected" };
}

export type RefillClaim =
  | { kind: "duplicate"; refill: RefillRecord }
  | { kind: "blocked"; code: RefillBlockCode }
  | { kind: "claimed"; refill: RefillRecord; providerOrderId: string };

export type RefillRunResult =
  | { kind: "duplicate"; refill: RefillRecord }
  | { kind: "blocked"; code: RefillBlockCode }
  | { kind: "processing"; refill: RefillRecord }
  | { kind: "rejected"; refill: RefillRecord }
  | { kind: "unknown"; refill: RefillRecord };

export async function runRefillRequest(ports: {
  claim(): Promise<RefillClaim>;
  requestRefill(providerOrderId: string): Promise<{ providerRefillId: string }>;
  markProcessing(id: string, providerRefillId: string, now: string): Promise<RefillRecord>;
  markRejected(id: string, code: RefillRejectCode, now: string): Promise<RefillRecord>;
  markUnknown(id: string, code: string, now: string): Promise<RefillRecord>;
  onEvent(action: string, metadata: Record<string, string | boolean>): void;
  now: string;
}): Promise<RefillRunResult> {
  const claimed = await ports.claim();
  if (claimed.kind === "duplicate") {
    ports.onEvent("REFILL_DUPLICATE_BLOCKED", { orderId: claimed.refill.orderId, refillRequestId: claimed.refill.id });
    return claimed;
  }
  if (claimed.kind === "blocked") return claimed;

  ports.onEvent("REFILL_REQUESTED", { orderId: claimed.refill.orderId, refillRequestId: claimed.refill.id });
  ports.onEvent("REFILL_SUBMIT_STARTED", { orderId: claimed.refill.orderId, refillRequestId: claimed.refill.id });

  try {
    const created = await ports.requestRefill(claimed.providerOrderId);
    const refill = await ports.markProcessing(claimed.refill.id, created.providerRefillId, ports.now);
    ports.onEvent("REFILL_SUBMITTED", { orderId: refill.orderId, refillRequestId: refill.id });
    return { kind: "processing", refill };
  } catch (error) {
    const failure = classifyRefillFailure(error);
    if (failure.outcome === "rejected") {
      const refill = await ports.markRejected(claimed.refill.id, failure.code, ports.now);
      ports.onEvent("REFILL_REJECTED", { orderId: refill.orderId, refillRequestId: refill.id, code: failure.code });
      return { kind: "rejected", refill };
    }
    const refill = await ports.markUnknown(claimed.refill.id, failure.code, ports.now);
    ports.onEvent("REFILL_UNKNOWN", { orderId: refill.orderId, refillRequestId: refill.id, code: failure.code });
    return { kind: "unknown", refill };
  }
}

function classifyRefillFailure(error: unknown): { outcome: "rejected"; code: RefillRejectCode } | { outcome: "unknown"; code: string } {
  if (error instanceof AppError && error.code === "PROVIDER_REJECTED") {
    return { outcome: "rejected", code: normalizeRefillReject(error.internalMessage ?? "") };
  }
  return { outcome: "unknown", code: "provider_unavailable" };
}
