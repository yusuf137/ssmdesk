import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { COLLECTIONS, REFILL_HISTORY_CAP } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { writeAuditLog, type AuditAction } from "@/lib/logging/audit";
import { isOrderId, isViewerId } from "@/lib/orders/id";
import { parseOrder } from "@/lib/orders/firestore-repository";
import type { OrderRecord } from "@/lib/orders/repository";
import {
  applyMappedRefillStatus,
  decideRefillEligibility,
  decideRefillSync,
  isActiveRefillStatus,
  isRefillStatus,
  mapProviderRefillStatus,
  refillBlockMessage,
  refillCooldownMs,
  runRefillRequest,
  toPublicRefill,
  type AdminRefillFilter,
  type PublicRefill,
  type RefillBlockCode,
  type RefillRecord,
  type RefillRejectCode,
  type RefillStatus,
} from "@/lib/refill/policy";
import { getSmmProvider } from "@/lib/smm";

type SlotRecord = {
  userId: string;
  activeRequestId: string | null;
  historyIds: string[];
  lastTerminalAt: string | null;
};

const REFILL_AUDIT = new Set<AuditAction>([
  "REFILL_REQUESTED",
  "REFILL_SUBMIT_STARTED",
  "REFILL_SUBMITTED",
  "REFILL_REJECTED",
  "REFILL_UNKNOWN",
  "REFILL_STATUS_SYNCED",
  "REFILL_COMPLETED",
  "REFILL_DUPLICATE_BLOCKED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digits(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,20}$/.test(value) ? value : null;
}

function stamp(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 40 ? value : null;
}

function code(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_]{1,40}$/.test(value) ? value : null;
}

function refillDocumentId(orderId: string): string {
  return createHash("sha256").update(`${orderId}:${randomUUID()}`, "utf8").digest("hex");
}

export function parseRefill(id: string, data: unknown): RefillRecord | null {
  if (!/^[a-f0-9]{64}$/.test(id) || !isRecord(data)) return null;
  if (typeof data.userId !== "string" || !isViewerId(data.userId)) return null;
  if (typeof data.orderId !== "string" || !isOrderId(data.orderId)) return null;
  if (data.provider !== "smmfull") return null;
  const providerOrderId = digits(data.providerOrderId);
  if (!providerOrderId || !isRefillStatus(data.status)) return null;
  const providerRefillId = data.providerRefillId === null ? null : digits(data.providerRefillId);
  if (data.providerRefillId !== null && providerRefillId === null) return null;
  const requestedAt = stamp(data.requestedAt);
  const createdAt = stamp(data.createdAt);
  const updatedAt = stamp(data.updatedAt);
  if (!requestedAt || !createdAt || !updatedAt) return null;
  return {
    id,
    userId: data.userId,
    orderId: data.orderId,
    provider: "smmfull",
    providerOrderId,
    providerRefillId,
    status: data.status,
    requestedAt,
    submittedAt: data.submittedAt === null ? null : stamp(data.submittedAt),
    completedAt: data.completedAt === null ? null : stamp(data.completedAt),
    rejectedAt: data.rejectedAt === null ? null : stamp(data.rejectedAt),
    lastCheckedAt: data.lastCheckedAt === null ? null : stamp(data.lastCheckedAt),
    providerStatus: data.providerStatus === null ? null : code(data.providerStatus),
    internalErrorCode: data.internalErrorCode === null ? null : code(data.internalErrorCode),
    createdAt,
    updatedAt,
  };
}

function refillDocument(record: RefillRecord): Omit<RefillRecord, "id"> {
  return {
    userId: record.userId,
    orderId: record.orderId,
    provider: "smmfull",
    providerOrderId: record.providerOrderId,
    providerRefillId: record.providerRefillId,
    status: record.status,
    requestedAt: record.requestedAt,
    submittedAt: record.submittedAt,
    completedAt: record.completedAt,
    rejectedAt: record.rejectedAt,
    lastCheckedAt: record.lastCheckedAt,
    providerStatus: record.providerStatus,
    internalErrorCode: record.internalErrorCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseSlot(data: unknown): SlotRecord | null {
  if (!isRecord(data) || typeof data.userId !== "string" || !isViewerId(data.userId)) return null;
  const historyIds = Array.isArray(data.historyIds)
    ? data.historyIds.filter((item): item is string => typeof item === "string" && /^[a-f0-9]{64}$/.test(item)).slice(0, REFILL_HISTORY_CAP)
    : [];
  return {
    userId: data.userId,
    activeRequestId: typeof data.activeRequestId === "string" && /^[a-f0-9]{64}$/.test(data.activeRequestId) ? data.activeRequestId : null,
    historyIds,
    lastTerminalAt: data.lastTerminalAt === null || data.lastTerminalAt === undefined ? null : stamp(data.lastTerminalAt),
  };
}

async function catalogRefillSupported(serviceId: number): Promise<boolean | null> {
  const services = await getSmmProvider().getServices();
  const match = services.find((service) => service.id === serviceId);
  return match ? match.refill === true : null;
}

function blockError(code: RefillBlockCode): AppError {
  const status = code === "not_owner" ? 404 : 400;
  const errorCode = code === "not_owner" ? "NOT_FOUND" : "INVALID_REQUEST";
  return new AppError(errorCode, status, refillBlockMessage(code), code);
}

export async function readOrderRefillView(
  userId: string,
  order: OrderRecord,
): Promise<{ canRequest: boolean; history: PublicRefill[] }> {
  if (order.userId !== userId) return { canRequest: false, history: [] };
  const database = getAdminFirestore();
  const [privateSnap, slotSnap] = await Promise.all([
    database.collection(COLLECTIONS.orderPrivate).doc(order.id).get(),
    database.collection(COLLECTIONS.refillSlots).doc(order.id).get(),
  ]);
  const slot = slotSnap.exists ? parseSlot(slotSnap.data()) : null;
  const history = await readHistory(slot?.historyIds ?? []);
  const active = history.find((entry) => entry.id === slot?.activeRequestId) ?? null;
  const supported =
    typeof order.refillSupported === "boolean" ? order.refillSupported : await catalogRefillSupported(order.serviceId);
  const decision = decideRefillEligibility({
    owner: true,
    providerOrderId: digits(privateSnap.get("providerOrderId")),
    refillSupported: supported,
    orderStatus: order.status,
    activeStatus: active && isActiveRefillStatus(active.status) ? active.status : null,
    lastTerminalAt: slot?.lastTerminalAt ?? null,
    nowMs: Date.now(),
    cooldownMs: refillCooldownMs(),
  });
  return {
    canRequest: decision.ok,
    history: history.map((entry) => toPublicRefill(entry)),
  };
}

async function readHistory(ids: string[]): Promise<RefillRecord[]> {
  if (ids.length === 0) return [];
  const database = getAdminFirestore();
  const snaps = await database.getAll(...ids.map((id) => database.collection(COLLECTIONS.refillRequests).doc(id)));
  return snaps
    .map((snap) => (snap.exists ? parseRefill(snap.id, snap.data()) : null))
    .filter((entry): entry is RefillRecord => entry !== null);
}

export async function requestOrderRefill(input: {
  userId: string;
  orderId: string;
  requestId: string;
  endpoint: string;
  now?: string;
}): Promise<{ refill: PublicRefill; duplicate: boolean }> {
  if (!isViewerId(input.userId) || !isOrderId(input.orderId)) {
    throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
  }
  const now = input.now ?? new Date().toISOString();
  const database = getAdminFirestore();
  const orderRef = database.collection(COLLECTIONS.orders).doc(input.orderId);
  const privateRef = database.collection(COLLECTIONS.orderPrivate).doc(input.orderId);
  const slotRef = database.collection(COLLECTIONS.refillSlots).doc(input.orderId);
  const preOrderSnap = await orderRef.get();
  const preOrder = preOrderSnap.exists ? parseOrder(input.orderId, preOrderSnap.data()) : null;
  if (!preOrder || preOrder.userId !== input.userId) throw blockError("not_owner");
  const fallbackSupport =
    typeof preOrder.refillSupported === "boolean" ? preOrder.refillSupported : await catalogRefillSupported(preOrder.serviceId);

  const result = await runRefillRequest({
    now,
    onEvent(action, metadata) {
      if (!REFILL_AUDIT.has(action as AuditAction)) return;
      void writeAuditLog({
        action: action as AuditAction,
        requestId: input.requestId,
        endpoint: input.endpoint,
        outcome: action === "REFILL_REJECTED" || action === "REFILL_UNKNOWN" || action === "REFILL_DUPLICATE_BLOCKED" ? "failure" : "success",
        userId: input.userId,
        metadata,
      });
    },
    async claim() {
      return database.runTransaction(async (transaction) => {
        const orderSnap = await transaction.get(orderRef);
        const privateSnap = await transaction.get(privateRef);
        const slotSnap = await transaction.get(slotRef);
        const order = orderSnap.exists ? parseOrder(input.orderId, orderSnap.data()) : null;
        const slot = slotSnap.exists ? parseSlot(slotSnap.data()) : null;
        const activeSnap = slot?.activeRequestId
          ? await transaction.get(database.collection(COLLECTIONS.refillRequests).doc(slot.activeRequestId))
          : null;
        const active = activeSnap?.exists ? parseRefill(activeSnap.id, activeSnap.data()) : null;
        const supported = typeof order?.refillSupported === "boolean" ? order.refillSupported : fallbackSupport;
        const decision = decideRefillEligibility({
          owner: order?.userId === input.userId,
          providerOrderId: digits(privateSnap.get("providerOrderId")),
          refillSupported: supported,
          orderStatus: order?.status ?? null,
          activeStatus: active && isActiveRefillStatus(active.status) ? active.status : null,
          lastTerminalAt: slot?.lastTerminalAt ?? null,
          nowMs: Date.parse(now),
          cooldownMs: refillCooldownMs(),
        });
        if (!decision.ok) {
          if (decision.code === "active_refill_exists" && active) return { kind: "duplicate" as const, refill: active };
          return { kind: "blocked" as const, code: decision.code };
        }
        const providerOrderId = digits(privateSnap.get("providerOrderId"));
        if (!order || !providerOrderId) return { kind: "blocked" as const, code: "missing_provider_order" as const };
        const refill: RefillRecord = {
          id: refillDocumentId(order.id),
          userId: order.userId,
          orderId: order.id,
          provider: "smmfull",
          providerOrderId,
          providerRefillId: null,
          status: "submitting",
          requestedAt: now,
          submittedAt: null,
          completedAt: null,
          rejectedAt: null,
          lastCheckedAt: null,
          providerStatus: null,
          internalErrorCode: null,
          createdAt: now,
          updatedAt: now,
        };
        transaction.create(database.collection(COLLECTIONS.refillRequests).doc(refill.id), refillDocument(refill));
        transaction.set(slotRef, {
          userId: order.userId,
          activeRequestId: refill.id,
          historyIds: [refill.id, ...(slot?.historyIds ?? [])].slice(0, REFILL_HISTORY_CAP),
          lastTerminalAt: slot?.lastTerminalAt ?? null,
        });
        return { kind: "claimed" as const, refill, providerOrderId };
      });
    },
    requestRefill(providerOrderId) {
      return getSmmProvider().requestRefill(providerOrderId);
    },
    markProcessing(id, providerRefillId, markedAt) {
      return updateRefill(id, (current) => {
        if (current.status !== "submitting" && current.status !== "requested") return current;
        return {
          ...current,
          status: "processing",
          providerRefillId,
          submittedAt: markedAt,
          providerStatus: "processing",
          updatedAt: markedAt,
        };
      });
    },
    markRejected(id, rejectCode, markedAt) {
      return finishRefill(id, "rejected", rejectCode, markedAt);
    },
    markUnknown(id, errorCode, markedAt) {
      return updateRefill(id, (current) => {
        if (current.status !== "submitting" && current.status !== "requested") return current;
        return { ...current, status: "unknown", internalErrorCode: errorCode, updatedAt: markedAt };
      });
    },
  });

  if (result.kind === "blocked") throw blockError(result.code);
  return { refill: toPublicRefill(result.refill), duplicate: result.kind === "duplicate" };
}

async function updateRefill(id: string, change: (current: RefillRecord) => RefillRecord): Promise<RefillRecord> {
  const database = getAdminFirestore();
  const ref = database.collection(COLLECTIONS.refillRequests).doc(id);
  return database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? parseRefill(id, snap.data()) : null;
    if (!current) throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "refill_unreadable");
    const next = change(current);
    if (next !== current) transaction.set(ref, refillDocument(next));
    return next;
  });
}

async function finishRefill(id: string, status: "rejected" | "completed", errorCode: RefillRejectCode | null, markedAt: string): Promise<RefillRecord> {
  const database = getAdminFirestore();
  const ref = database.collection(COLLECTIONS.refillRequests).doc(id);
  return database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? parseRefill(id, snap.data()) : null;
    if (!current) throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "refill_unreadable");
    if (current.status !== "submitting" && current.status !== "requested" && current.status !== "processing" && current.status !== "unknown") {
      return current;
    }
    const next: RefillRecord = {
      ...current,
      status,
      internalErrorCode: errorCode,
      rejectedAt: status === "rejected" ? markedAt : current.rejectedAt,
      completedAt: status === "completed" ? markedAt : current.completedAt,
      updatedAt: markedAt,
    };
    const slotRef = database.collection(COLLECTIONS.refillSlots).doc(current.orderId);
    const slotSnap = await transaction.get(slotRef);
    const slot = slotSnap.exists ? parseSlot(slotSnap.data()) : null;
    transaction.set(ref, refillDocument(next));
    if (slot && slot.activeRequestId === current.id) {
      transaction.set(slotRef, {
        userId: slot.userId,
        activeRequestId: null,
        historyIds: slot.historyIds,
        lastTerminalAt: markedAt,
      });
    }
    return next;
  });
}

export async function readRefillForUser(refillId: string, userId: string): Promise<RefillRecord | null> {
  if (!/^[a-f0-9]{64}$/.test(refillId) || !isViewerId(userId)) return null;
  const snap = await getAdminFirestore().collection(COLLECTIONS.refillRequests).doc(refillId).get();
  if (!snap.exists) return null;
  const record = parseRefill(snap.id, snap.data());
  if (!record || record.userId !== userId) return null;
  return record;
}

export async function syncRefillStatus(
  refillId: string,
  options: { force?: boolean; now?: string; requestId: string; endpoint: string; actorId?: string } ,
): Promise<RefillRecord | null> {
  if (!/^[a-f0-9]{64}$/.test(refillId)) return null;
  const database = getAdminFirestore();
  const ref = database.collection(COLLECTIONS.refillRequests).doc(refillId);
  const snap = await ref.get();
  const current = snap.exists ? parseRefill(snap.id, snap.data()) : null;
  if (!current) return null;
  const now = options.now ?? new Date().toISOString();
  const decision = decideRefillSync({
    status: current.status,
    providerRefillId: current.providerRefillId,
    lastCheckedAt: current.lastCheckedAt,
    nowMs: Date.parse(now),
    force: options.force === true,
  });
  if (decision === "skip" || !current.providerRefillId) return current;

  let mapped: ReturnType<typeof mapProviderRefillStatus>;
  try {
    const provider = await getSmmProvider().getRefillStatus(current.providerRefillId);
    mapped = mapProviderRefillStatus(provider.status);
  } catch {
    const saved = await updateRefill(current.id, (record) => ({
      ...record,
      lastCheckedAt: now,
      updatedAt: now,
      internalErrorCode: record.internalErrorCode ?? "provider_unavailable",
    }));
    await auditSync(options, saved, "failure", "provider_unavailable");
    return saved;
  }

  const saved = await database.runTransaction(async (transaction) => {
    const freshSnap = await transaction.get(ref);
    const fresh = freshSnap.exists ? parseRefill(refillId, freshSnap.data()) : null;
    if (!fresh) return null;
    if (fresh.status === "completed" || fresh.status === "rejected" || fresh.status === "failed") return fresh;
    const next = applyMappedRefillStatus(fresh, mapped, now);
    const slotRef = database.collection(COLLECTIONS.refillSlots).doc(fresh.orderId);
    const slotSnap = await transaction.get(slotRef);
    const slot = slotSnap.exists ? parseSlot(slotSnap.data()) : null;
    transaction.set(ref, refillDocument(next.refill));
    if (next.releaseActive && slot && slot.activeRequestId === fresh.id) {
      transaction.set(slotRef, {
        userId: slot.userId,
        activeRequestId: null,
        historyIds: slot.historyIds,
        lastTerminalAt: now,
      });
    }
    return next.refill;
  });
  if (!saved) return null;
  await auditSync(options, saved, "success", mapped);
  if (saved.status === "completed") {
    await writeAuditLog({
      action: "REFILL_COMPLETED",
      requestId: options.requestId,
      endpoint: options.endpoint,
      outcome: "success",
      userId: options.actorId,
      metadata: { orderId: saved.orderId, refillRequestId: saved.id },
    });
  }
  return saved;
}

async function auditSync(
  options: { requestId: string; endpoint: string; actorId?: string },
  record: RefillRecord,
  outcome: "success" | "failure",
  code: string,
): Promise<void> {
  await writeAuditLog({
    action: "REFILL_STATUS_SYNCED",
    requestId: options.requestId,
    endpoint: options.endpoint,
    outcome,
    userId: options.actorId,
    metadata: { orderId: record.orderId, refillRequestId: record.id, code },
  });
}

export async function listAdminRefills(status: AdminRefillFilter): Promise<
  Array<{
    id: string;
    orderId: string;
    userId: string;
    email: string | null;
    providerOrderId: string;
    providerRefillId: string | null;
    status: RefillStatus;
    createdAt: string;
    lastCheckedAt: string | null;
    internalErrorCode: string | null;
  }>
> {
  const database = getAdminFirestore();
  const snapshot = await database.collection(COLLECTIONS.refillRequests).where("status", "==", status).limit(40).get();
  const records = snapshot.docs
    .map((document) => parseRefill(document.id, document.data()))
    .filter((record): record is RefillRecord => record !== null)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
  const userIds = [...new Set(records.map((record) => record.userId))];
  const users = userIds.length
    ? await database.getAll(...userIds.map((id) => database.collection(COLLECTIONS.users).doc(id)))
    : [];
  const emails = new Map(
    users.map((document) => [document.id, typeof document.get("email") === "string" ? document.get("email") : null]),
  );
  return records.map((record) => ({
    id: record.id,
    orderId: record.orderId,
    userId: record.userId,
    email: emails.get(record.userId) ?? null,
    providerOrderId: record.providerOrderId,
    providerRefillId: record.providerRefillId,
    status: record.status,
    createdAt: record.createdAt,
    lastCheckedAt: record.lastCheckedAt,
    internalErrorCode: record.internalErrorCode,
  }));
}
