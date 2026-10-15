import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { cancelRefundLedgerId } from "@/lib/cancel/ids";
import {
  cancelBlockMessage,
  decideCancelEligibility,
  decideCancelSettlement,
  decideCancelSync,
  isActiveCancelStatus,
  isCancelStatus,
  runCancelRequest,
  toPublicCancel,
  type AdminCancelFilter,
  type CancelBlockCode,
  type CancelRecord,
  type CancelRejectCode,
  type CancelStatus,
  type PublicCancel,
} from "@/lib/cancel/policy";
import { COLLECTIONS, REFILL_HISTORY_CAP } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { writeAuditLog, type AuditAction } from "@/lib/logging/audit";
import { isOrderId, isViewerId } from "@/lib/orders/id";
import { parseOrder } from "@/lib/orders/firestore-repository";
import type { OrderRecord } from "@/lib/orders/repository";
import { getSmmProvider } from "@/lib/smm";
import { refundOrderAmountToWallet } from "@/lib/wallet/firestore-read";

type SlotRecord = {
  userId: string;
  activeRequestId: string | null;
  historyIds: string[];
  previousOrderStatus: "in_progress" | "partial" | null;
};

const CANCEL_AUDIT = new Set<AuditAction>([
  "CANCEL_REQUESTED",
  "CANCEL_SUBMITTED",
  "CANCEL_REJECTED",
  "CANCEL_UNKNOWN",
  "CANCEL_STATUS_SYNCED",
  "CANCEL_SETTLEMENT_STARTED",
  "CANCEL_REFUND_APPLIED",
  "CANCEL_COMPLETED",
  "CANCEL_DUPLICATE_BLOCKED",
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

function cancelDocumentId(orderId: string): string {
  return createHash("sha256").update(`${orderId}:${randomUUID()}`, "utf8").digest("hex");
}

function parseCancel(id: string, data: unknown): CancelRecord | null {
  if (!/^[a-f0-9]{64}$/.test(id) || !isRecord(data)) return null;
  if (typeof data.userId !== "string" || !isViewerId(data.userId)) return null;
  if (typeof data.orderId !== "string" || !isOrderId(data.orderId)) return null;
  if (data.provider !== "smmfull" || !isCancelStatus(data.status)) return null;
  const providerOrderId = digits(data.providerOrderId);
  const requestedAt = stamp(data.requestedAt);
  const createdAt = stamp(data.createdAt);
  const updatedAt = stamp(data.updatedAt);
  if (!providerOrderId || !requestedAt || !createdAt || !updatedAt) return null;
  if (data.previousOrderStatus !== "in_progress" && data.previousOrderStatus !== "partial") return null;
  const providerRefill = data.internalErrorCode;
  return {
    id,
    userId: data.userId,
    orderId: data.orderId,
    provider: "smmfull",
    providerOrderId,
    status: data.status,
    previousOrderStatus: data.previousOrderStatus,
    requestedAt,
    submittedAt: data.submittedAt === null ? null : stamp(data.submittedAt),
    completedAt: data.completedAt === null ? null : stamp(data.completedAt),
    rejectedAt: data.rejectedAt === null ? null : stamp(data.rejectedAt),
    lastCheckedAt: data.lastCheckedAt === null ? null : stamp(data.lastCheckedAt),
    internalErrorCode: providerRefill === null ? null : code(providerRefill),
    createdAt,
    updatedAt,
  };
}

function cancelDocument(record: CancelRecord): Omit<CancelRecord, "id"> {
  return {
    userId: record.userId,
    orderId: record.orderId,
    provider: "smmfull",
    providerOrderId: record.providerOrderId,
    status: record.status,
    previousOrderStatus: record.previousOrderStatus,
    requestedAt: record.requestedAt,
    submittedAt: record.submittedAt,
    completedAt: record.completedAt,
    rejectedAt: record.rejectedAt,
    lastCheckedAt: record.lastCheckedAt,
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
    previousOrderStatus: data.previousOrderStatus === "in_progress" || data.previousOrderStatus === "partial" ? data.previousOrderStatus : null,
  };
}

function blockError(block: CancelBlockCode): AppError {
  return new AppError(block === "not_owner" ? "NOT_FOUND" : "INVALID_REQUEST", block === "not_owner" ? 404 : 400, cancelBlockMessage(block), block);
}

async function catalogCancelSupported(serviceId: number): Promise<boolean | null> {
  const services = await getSmmProvider().getServices();
  const match = services.find((service) => service.id === serviceId);
  return match ? match.cancel === true : null;
}

async function readHistory(ids: string[]): Promise<CancelRecord[]> {
  if (ids.length === 0) return [];
  const database = getAdminFirestore();
  const snaps = await database.getAll(...ids.map((id) => database.collection(COLLECTIONS.cancelRequests).doc(id)));
  return snaps
    .map((snap) => (snap.exists ? parseCancel(snap.id, snap.data()) : null))
    .filter((entry): entry is CancelRecord => entry !== null);
}

export async function readOrderCancelView(userId: string, order: OrderRecord): Promise<{ canRequest: boolean; history: PublicCancel[] }> {
  if (order.userId !== userId) return { canRequest: false, history: [] };
  const database = getAdminFirestore();
  const [privateSnap, slotSnap] = await Promise.all([
    database.collection(COLLECTIONS.orderPrivate).doc(order.id).get(),
    database.collection(COLLECTIONS.cancelSlots).doc(order.id).get(),
  ]);
  const slot = slotSnap.exists ? parseSlot(slotSnap.data()) : null;
  const history = await readHistory(slot?.historyIds ?? []);
  const active = history.find((entry) => entry.id === slot?.activeRequestId) ?? null;
  const supported = typeof order.cancelSupported === "boolean" ? order.cancelSupported : await catalogCancelSupported(order.serviceId);
  const decision = decideCancelEligibility({
    owner: true,
    providerOrderId: digits(privateSnap.get("providerOrderId")),
    cancelSupported: supported,
    orderStatus: order.status,
    activeStatus: active && isActiveCancelStatus(active.status) ? active.status : null,
  });
  return { canRequest: decision.ok, history: history.map((entry) => toPublicCancel(entry)) };
}

export async function requestOrderCancel(input: {
  userId: string;
  orderId: string;
  requestId: string;
  endpoint: string;
  now?: string;
}): Promise<{ cancel: PublicCancel; duplicate: boolean }> {
  if (!isViewerId(input.userId) || !isOrderId(input.orderId)) throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
  const now = input.now ?? new Date().toISOString();
  const database = getAdminFirestore();
  const orderRef = database.collection(COLLECTIONS.orders).doc(input.orderId);
  const privateRef = database.collection(COLLECTIONS.orderPrivate).doc(input.orderId);
  const slotRef = database.collection(COLLECTIONS.cancelSlots).doc(input.orderId);
  const preSnap = await orderRef.get();
  const preOrder = preSnap.exists ? parseOrder(input.orderId, preSnap.data()) : null;
  if (!preOrder || preOrder.userId !== input.userId) throw blockError("not_owner");
  const fallback = typeof preOrder.cancelSupported === "boolean" ? preOrder.cancelSupported : await catalogCancelSupported(preOrder.serviceId);

  const result = await runCancelRequest({
    now,
    onEvent(action, metadata) {
      if (!CANCEL_AUDIT.has(action as AuditAction)) return;
      void writeAuditLog({
        action: action as AuditAction,
        requestId: input.requestId,
        endpoint: input.endpoint,
        outcome: action.includes("REJECTED") || action.includes("UNKNOWN") || action.includes("DUPLICATE") ? "failure" : "success",
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
          ? await transaction.get(database.collection(COLLECTIONS.cancelRequests).doc(slot.activeRequestId))
          : null;
        const active = activeSnap?.exists ? parseCancel(activeSnap.id, activeSnap.data()) : null;
        const supported = typeof order?.cancelSupported === "boolean" ? order.cancelSupported : fallback;
        const decision = decideCancelEligibility({
          owner: order?.userId === input.userId,
          providerOrderId: digits(privateSnap.get("providerOrderId")),
          cancelSupported: supported,
          orderStatus: order?.status ?? null,
          activeStatus: active && isActiveCancelStatus(active.status) ? active.status : null,
        });
        if (!decision.ok) {
          if (decision.code === "active_cancel_exists" && active) return { kind: "duplicate" as const, cancel: active };
          return { kind: "blocked" as const, code: decision.code };
        }
        const providerOrderId = digits(privateSnap.get("providerOrderId"));
        if (!order || !providerOrderId || (order.status !== "in_progress" && order.status !== "partial")) {
          return { kind: "blocked" as const, code: "not_eligible" as const };
        }
        const cancel: CancelRecord = {
          id: cancelDocumentId(order.id),
          userId: order.userId,
          orderId: order.id,
          provider: "smmfull",
          providerOrderId,
          status: "submitting",
          previousOrderStatus: order.status,
          requestedAt: now,
          submittedAt: null,
          completedAt: null,
          rejectedAt: null,
          lastCheckedAt: null,
          internalErrorCode: null,
          createdAt: now,
          updatedAt: now,
        };
        transaction.create(database.collection(COLLECTIONS.cancelRequests).doc(cancel.id), cancelDocument(cancel));
        transaction.set(slotRef, {
          userId: order.userId,
          activeRequestId: cancel.id,
          historyIds: [cancel.id, ...(slot?.historyIds ?? [])].slice(0, REFILL_HISTORY_CAP),
          previousOrderStatus: order.status,
        });
        transaction.update(orderRef, { status: "cancel_requested", updatedAt: now });
        return { kind: "claimed" as const, cancel, providerOrderId };
      });
    },
    requestCancel(providerOrderId) {
      return getSmmProvider().requestCancel(providerOrderId);
    },
    markAccepted(id, markedAt) {
      return updateCancel(id, (current) => ({
        ...current,
        status: current.status === "submitting" || current.status === "requested" ? "accepted" : current.status,
        submittedAt: markedAt,
        updatedAt: markedAt,
      }), { orderStatus: "cancel_pending_settlement" });
    },
    markRejected(id, rejectCode, markedAt) {
      return finishCancel(id, "rejected", rejectCode, markedAt, "restore");
    },
    markUnknown(id, errorCode, markedAt) {
      return updateCancel(
        id,
        (current) =>
          current.status === "submitting" || current.status === "requested"
            ? { ...current, status: "unknown", internalErrorCode: errorCode, updatedAt: markedAt }
            : current,
        { orderStatus: "cancel_processing" },
      );
    },
  });

  if (result.kind === "blocked") throw blockError(result.code);
  if (result.kind === "accepted") {
    await syncCancelStatus(result.cancel.id, {
      force: true,
      now,
      requestId: input.requestId,
      endpoint: input.endpoint,
      actorId: input.userId,
    });
  }
  const fresh = await getAdminFirestore().collection(COLLECTIONS.cancelRequests).doc(result.cancel.id).get();
  const stored = fresh.exists ? parseCancel(fresh.id, fresh.data()) : null;
  return { cancel: toPublicCancel(stored ?? result.cancel), duplicate: result.kind === "duplicate" };
}

async function updateCancel(
  id: string,
  change: (current: CancelRecord) => CancelRecord,
  options: { orderStatus?: "cancel_pending_settlement" | "cancel_processing" } = {},
): Promise<CancelRecord> {
  const database = getAdminFirestore();
  const ref = database.collection(COLLECTIONS.cancelRequests).doc(id);
  return database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? parseCancel(id, snap.data()) : null;
    if (!current) throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "cancel_unreadable");
    const orderRef = database.collection(COLLECTIONS.orders).doc(current.orderId);
    const orderSnap = options.orderStatus ? await transaction.get(orderRef) : null;
    const next = change(current);
    if (next !== current) transaction.set(ref, cancelDocument(next));
    const order = orderSnap?.exists ? parseOrder(current.orderId, orderSnap.data()) : null;
    if (options.orderStatus && order && (order.status === "cancel_requested" || order.status === "cancel_processing" || order.status === "cancel_pending_settlement")) {
      transaction.update(orderRef, { status: options.orderStatus, updatedAt: next.updatedAt });
    }
    return next;
  });
}

async function finishCancel(
  id: string,
  status: "rejected" | "completed",
  errorCode: CancelRejectCode | null,
  markedAt: string,
  orderMode: "restore" | "keep",
): Promise<CancelRecord> {
  const database = getAdminFirestore();
  const ref = database.collection(COLLECTIONS.cancelRequests).doc(id);
  return database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? parseCancel(id, snap.data()) : null;
    if (!current) throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "cancel_unreadable");
    if (current.status === "completed" || current.status === "rejected") return current;
    const next: CancelRecord = {
      ...current,
      status,
      internalErrorCode: errorCode,
      rejectedAt: status === "rejected" ? markedAt : current.rejectedAt,
      completedAt: status === "completed" ? markedAt : current.completedAt,
      updatedAt: markedAt,
    };
    const slotRef = database.collection(COLLECTIONS.cancelSlots).doc(current.orderId);
    const orderRef = database.collection(COLLECTIONS.orders).doc(current.orderId);
    const slotSnap = await transaction.get(slotRef);
    const orderSnap = await transaction.get(orderRef);
    const slot = slotSnap.exists ? parseSlot(slotSnap.data()) : null;
    const order = orderSnap.exists ? parseOrder(current.orderId, orderSnap.data()) : null;
    transaction.set(ref, cancelDocument(next));
    if (slot && slot.activeRequestId === current.id) {
      transaction.set(slotRef, { userId: slot.userId, activeRequestId: null, historyIds: slot.historyIds, previousOrderStatus: slot.previousOrderStatus });
    }
    if (orderMode === "restore" && order && (order.status === "cancel_requested" || order.status === "cancel_processing" || order.status === "cancel_pending_settlement")) {
      transaction.update(orderRef, { status: current.previousOrderStatus, updatedAt: markedAt });
    }
    return next;
  });
}

export async function syncCancelStatus(
  cancelId: string,
  options: { force?: boolean; now?: string; requestId: string; endpoint: string; actorId?: string },
): Promise<CancelRecord | null> {
  if (!/^[a-f0-9]{64}$/.test(cancelId)) return null;
  const database = getAdminFirestore();
  const ref = database.collection(COLLECTIONS.cancelRequests).doc(cancelId);
  const snap = await ref.get();
  const current = snap.exists ? parseCancel(snap.id, snap.data()) : null;
  if (!current) return null;
  const now = options.now ?? new Date().toISOString();
  if (
    decideCancelSync({ status: current.status, lastCheckedAt: current.lastCheckedAt, nowMs: Date.parse(now), force: options.force === true }) ===
    "skip"
  ) {
    return current;
  }

  let providerStatus = "";
  let remains: number | null = null;
  try {
    const provider = await getSmmProvider().getOrderStatus(current.providerOrderId);
    providerStatus = provider.status;
    remains = provider.remains !== null && Number.isSafeInteger(provider.remains) ? provider.remains : null;
  } catch {
    const saved = await updateCancel(current.id, (record) => ({
      ...record,
      status: record.status === "accepted" ? "pending_settlement" : record.status,
      lastCheckedAt: now,
      updatedAt: now,
      internalErrorCode: record.internalErrorCode ?? "provider_unavailable",
    }));
    await writeAuditLog({
      action: "CANCEL_STATUS_SYNCED",
      requestId: options.requestId,
      endpoint: options.endpoint,
      outcome: "failure",
      userId: options.actorId,
      metadata: { orderId: saved.orderId, cancelRequestId: saved.id, code: "provider_unavailable" },
    });
    return saved;
  }

  const orderSnap = await database.collection(COLLECTIONS.orders).doc(current.orderId).get();
  const order = orderSnap.exists ? parseOrder(current.orderId, orderSnap.data()) : null;
  if (!order) return current;
  const decision = decideCancelSettlement({
    salePriceMinor: order.salePriceMinor,
    quantity: order.quantity,
    remains,
    providerStatus,
  });
  await writeAuditLog({
    action: "CANCEL_STATUS_SYNCED",
    requestId: options.requestId,
    endpoint: options.endpoint,
    outcome: "success",
    userId: options.actorId,
    metadata: { orderId: current.orderId, cancelRequestId: current.id, code: decision.kind },
  });
  if (decision.kind === "wait") {
    return updateCancel(current.id, (record) => ({ ...record, status: "pending_settlement", lastCheckedAt: now, updatedAt: now }), {
      orderStatus: "cancel_pending_settlement",
    });
  }

  await writeAuditLog({
    action: "CANCEL_SETTLEMENT_STARTED",
    requestId: options.requestId,
    endpoint: options.endpoint,
    outcome: "success",
    userId: options.actorId,
    metadata: { orderId: current.orderId, cancelRequestId: current.id, code: decision.kind },
  });
  if (decision.kind === "refund") {
    const money = await refundOrderAmountToWallet({
      orderId: current.orderId,
      amountMinor: decision.amountMinor,
      referenceId: current.id,
      ledgerId: cancelRefundLedgerId(current.orderId, current.id),
      nextStatus: decision.orderStatus,
      now,
    });
    if (money === "not_refundable" || money === "missing") {
      return updateCancel(current.id, (record) => ({ ...record, status: "pending_settlement", lastCheckedAt: now, updatedAt: now, internalErrorCode: "settlement_blocked" }));
    }
  } else {
    await database.collection(COLLECTIONS.orders).doc(current.orderId).update({ status: decision.orderStatus, updatedAt: now });
  }
  const finished = await finishCancel(current.id, "completed", null, now, "keep");
  await writeAuditLog({
    action: "CANCEL_COMPLETED",
    requestId: options.requestId,
    endpoint: options.endpoint,
    outcome: "success",
    userId: options.actorId,
    metadata: { orderId: current.orderId, cancelRequestId: current.id },
  });
  return finished;
}

export async function readCancelForUser(cancelId: string, userId: string): Promise<CancelRecord | null> {
  if (!/^[a-f0-9]{64}$/.test(cancelId) || !isViewerId(userId)) return null;
  const snap = await getAdminFirestore().collection(COLLECTIONS.cancelRequests).doc(cancelId).get();
  const record = snap.exists ? parseCancel(snap.id, snap.data()) : null;
  return record && record.userId === userId ? record : null;
}

export async function listAdminCancels(status: AdminCancelFilter): Promise<
  Array<{
    id: string;
    orderId: string;
    userId: string;
    email: string | null;
    providerOrderId: string;
    status: CancelStatus;
    createdAt: string;
    lastCheckedAt: string | null;
    internalErrorCode: string | null;
  }>
> {
  const database = getAdminFirestore();
  const statuses = status === "processing" ? ["processing", "submitting", "requested"] : [status];
  const snapshot = await database.collection(COLLECTIONS.cancelRequests).where("status", "in", statuses).limit(40).get();
  const records = snapshot.docs
    .map((document) => parseCancel(document.id, document.data()))
    .filter((record): record is CancelRecord => record !== null)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
  const userIds = [...new Set(records.map((record) => record.userId))];
  const users = userIds.length ? await database.getAll(...userIds.map((id) => database.collection(COLLECTIONS.users).doc(id))) : [];
  const emails = new Map(users.map((document) => [document.id, typeof document.get("email") === "string" ? document.get("email") : null]));
  return records.map((record) => ({
    id: record.id,
    orderId: record.orderId,
    userId: record.userId,
    email: emails.get(record.userId) ?? null,
    providerOrderId: record.providerOrderId,
    status: record.status,
    createdAt: record.createdAt,
    lastCheckedAt: record.lastCheckedAt,
    internalErrorCode: record.internalErrorCode,
  }));
}
