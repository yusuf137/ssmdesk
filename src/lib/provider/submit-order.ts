import "server-only";

import { randomUUID } from "node:crypto";

import { COLLECTIONS } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { writeAuditLog, type AuditAction } from "@/lib/logging/audit";
import { isOrderId } from "@/lib/orders/id";
import { parseOrder } from "@/lib/orders/firestore-repository";
import {
  decideProviderSubmitClaim,
  runProviderSubmission,
  type SubmissionResult,
  type SubmissionSnapshot,
} from "@/lib/provider/submission";
import { getSmmProvider } from "@/lib/smm";
import { refundOrderToWallet } from "@/lib/wallet/firestore-read";

const AUDIT_ACTIONS = new Set<AuditAction>([
  "PROVIDER_BALANCE_CHECKED",
  "PROVIDER_ORDER_SUBMIT_STARTED",
  "PROVIDER_ORDER_SUBMITTED",
  "PROVIDER_ORDER_REJECTED",
  "PROVIDER_ORDER_UNKNOWN",
  "PROVIDER_ORDER_REFUNDED",
  "PROVIDER_ORDER_WAITING_FUNDS",
  "PROVIDER_CURRENCY_MISMATCH",
]);

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function digits(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,20}$/.test(value) ? value : null;
}

function readSnapshot(orderId: string, orderData: unknown, privateData: Record<string, unknown> | undefined): SubmissionSnapshot | null {
  const order = parseOrder(orderId, orderData);
  if (!order || !privateData) return null;
  const cost = privateData.providerCostMinor;
  if (typeof cost !== "number" || !Number.isSafeInteger(cost) || cost < 0) return null;
  const attempts = privateData.submissionAttemptCount;
  return {
    status: order.status,
    userId: order.userId,
    serviceId: order.serviceId,
    targetUrl: order.targetUrl,
    quantity: order.quantity,
    salePriceMinor: order.salePriceMinor,
    providerCostMinor: cost,
    providerCurrency: text(privateData.providerCurrency, 3),
    providerOrderId: digits(privateData.providerOrderId),
    submissionAttemptId: text(privateData.submissionAttemptId, 80),
    submissionAttemptCount: typeof attempts === "number" && Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0,
  };
}

function marginOf(snapshot: SubmissionSnapshot): number | null {
  const value = snapshot.salePriceMinor - snapshot.providerCostMinor;
  return Number.isSafeInteger(value) ? value : null;
}

export async function submitPaidOrder(
  orderId: string,
  options: { allowUnknownRetry?: boolean; now?: string } = {},
): Promise<SubmissionResult> {
  if (!isOrderId(orderId)) return "blocked";
  const database = getAdminFirestore();
  const orderRef = database.collection(COLLECTIONS.orders).doc(orderId);
  const privateRef = database.collection(COLLECTIONS.orderPrivate).doc(orderId);
  const allowUnknownRetry = options.allowUnknownRetry === true;
  const now = options.now ?? new Date().toISOString();
  const attemptId = randomUUID();

  return runProviderSubmission({
    orderId,
    allowUnknownRetry,
    now,
    attemptId,
    onEvent(action, metadata) {
      if (!AUDIT_ACTIONS.has(action as AuditAction)) return;
      void writeAuditLog({
        action: action as AuditAction,
        requestId: "provider-submit",
        endpoint: "submitPaidOrder",
        outcome:
          action.includes("UNKNOWN") || action.includes("REJECTED") || action.includes("MISMATCH") || action.includes("WAITING")
            ? "failure"
            : "success",
        metadata,
      });
    },
    ports: {
      async claim(currentAttempt, claimedAt) {
        return database.runTransaction(async (transaction) => {
          const orderSnap = await transaction.get(orderRef);
          const privateSnap = await transaction.get(privateRef);
          const snapshot = readSnapshot(orderId, orderSnap.data(), privateSnap.data());
          const decision = decideProviderSubmitClaim({
            status: snapshot?.status ?? null,
            providerOrderId: snapshot?.providerOrderId ?? null,
            allowUnknownRetry,
          });
          if (!snapshot || decision !== "claim") {
            return { ok: false as const, reason: decision === "duplicate" ? "duplicate" as const : "blocked" as const };
          }
          const nextCount = snapshot.submissionAttemptCount + 1;
          const margin = marginOf(snapshot);
          transaction.update(orderRef, { status: "submitting", updatedAt: claimedAt });
          transaction.set(
            privateRef,
            {
              submissionAttemptId: currentAttempt,
              submissionAttemptCount: nextCount,
              lastSubmissionAttemptAt: claimedAt,
              ...(margin === null ? {} : { grossMarginMinor: margin }),
            },
            { merge: true },
          );
          return {
            ok: true as const,
            snapshot: { ...snapshot, status: "submitting" as const, submissionAttemptId: currentAttempt, submissionAttemptCount: nextCount },
          };
        });
      },
      async rememberCurrency(currentAttempt, currency) {
        return database.runTransaction(async (transaction) => {
          const orderSnap = await transaction.get(orderRef);
          const privateSnap = await transaction.get(privateRef);
          const snapshot = readSnapshot(orderId, orderSnap.data(), privateSnap.data());
          if (!snapshot || snapshot.submissionAttemptId !== currentAttempt || snapshot.status !== "submitting") return false;
          transaction.set(privateRef, { providerCurrency: currency }, { merge: true });
          return true;
        });
      },
      async release(currentAttempt, markedAt) {
        await database.runTransaction(async (transaction) => {
          const privateSnap = await transaction.get(privateRef);
          if (privateSnap.get("submissionAttemptId") !== currentAttempt) return;
          if (digits(privateSnap.get("providerOrderId"))) return;
          transaction.update(orderRef, { status: "checking_provider_balance", updatedAt: markedAt });
        });
      },
      async markAwaiting(currentAttempt, markedAt) {
        await database.runTransaction(async (transaction) => {
          const privateSnap = await transaction.get(privateRef);
          if (privateSnap.get("submissionAttemptId") !== currentAttempt) return;
          transaction.update(orderRef, { status: "awaiting_provider_funds", updatedAt: markedAt });
        });
      },
      async markUnknown(currentAttempt, markedAt, errorCode) {
        await database.runTransaction(async (transaction) => {
          const privateSnap = await transaction.get(privateRef);
          if (privateSnap.get("submissionAttemptId") !== currentAttempt) return;
          transaction.update(orderRef, { status: "submission_unknown", updatedAt: markedAt });
          transaction.set(
            privateRef,
            { submissionErrorCode: errorCode, lastSubmissionAttemptAt: markedAt },
            { merge: true },
          );
        });
      },
      async markRejected(currentAttempt, markedAt, errorCode) {
        return database.runTransaction(async (transaction) => {
          const privateSnap = await transaction.get(privateRef);
          const orderSnap = await transaction.get(orderRef);
          const snapshot = readSnapshot(orderId, orderSnap.data(), privateSnap.data());
          if (!snapshot || snapshot.submissionAttemptId !== currentAttempt || snapshot.providerOrderId) return false;
          transaction.update(orderRef, { status: "failed", updatedAt: markedAt });
          transaction.set(privateRef, { submissionErrorCode: errorCode, lastSubmissionAttemptAt: markedAt }, { merge: true });
          return true;
        });
      },
      async markSubmitted(currentAttempt, markedAt, providerOrderId) {
        return database.runTransaction(async (transaction) => {
          const privateSnap = await transaction.get(privateRef);
          const orderSnap = await transaction.get(orderRef);
          const snapshot = readSnapshot(orderId, orderSnap.data(), privateSnap.data());
          if (!snapshot || snapshot.submissionAttemptId !== currentAttempt || snapshot.status !== "submitting") return false;
          if (snapshot.providerOrderId) return false;
          transaction.update(orderRef, { status: "in_progress", updatedAt: markedAt });
          transaction.set(
            privateRef,
            {
              providerOrderId,
              providerStatus: "pending",
              submittedAt: markedAt,
              submissionErrorCode: null,
            },
            { merge: true },
          );
          return true;
        });
      },
      async getBalance() {
        const balance = await getSmmProvider().getBalance();
        return { balanceMinor: balance.balanceMinor, currency: balance.currency };
      },
      async createOrder(order) {
        return getSmmProvider().createOrder({
          serviceId: order.serviceId,
          targetUrl: order.targetUrl,
          quantity: order.quantity,
        });
      },
      refund(currentOrderId) {
        return refundOrderToWallet(currentOrderId, "provider_rejected");
      },
    },
  });
}
