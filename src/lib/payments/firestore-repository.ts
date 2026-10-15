import "server-only";

import { COLLECTIONS } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { isOrderId, isViewerId } from "@/lib/orders/id";
import { parseOrder } from "@/lib/orders/firestore-repository";
import type { OrderAccess, OrderRecord } from "@/lib/orders/repository";
import type { PaymentRepository } from "@/lib/payments/repository";
import {
  decideCallback,
  decideSubmitClaim,
  type CallbackDecision,
  type PaymentPurpose,
  type PaymentRecord,
  type PaymentStatus,
} from "@/lib/payments/record";
import { applyTopup } from "@/lib/wallet/apply";
import { ledgerDocument, parseLedger, parseWallet, walletDocument } from "@/lib/wallet/documents";
import { topupLedgerId } from "@/lib/wallet/types";

const MERCHANT_OID = /^[a-z0-9]{8,64}$/;

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return value === "initiated" || value === "succeeded" || value === "failed";
}

function parsePayment(id: string, data: unknown): PaymentRecord | null {
  if (!MERCHANT_OID.test(id) || typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.userId !== "string" || !isViewerId(record.userId)) return null;
  if (record.provider !== "paytr" || record.merchantOid !== id) return null;
  if (record.currency !== "TRY") return null;
  if (typeof record.amountMinor !== "number" || !Number.isSafeInteger(record.amountMinor) || record.amountMinor <= 0) {
    return null;
  }
  if (!isPaymentStatus(record.status)) return null;
  if (typeof record.createdAt !== "string" || typeof record.updatedAt !== "string") return null;
  const purpose = readPurpose(record);
  if (!purpose) return null;
  return {
    userId: record.userId,
    provider: "paytr",
    type: purpose.type,
    merchantOid: id,
    amountMinor: record.amountMinor,
    currency: "TRY",
    status: record.status,
    orderId: purpose.orderId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function readPurpose(record: Record<string, unknown>): { type: PaymentPurpose; orderId: string | null } | null {
  if (record.type === "wallet_topup") {
    return record.orderId == null ? { type: "wallet_topup", orderId: null } : null;
  }
  if (record.type === "order" || record.type === undefined) {
    return typeof record.orderId === "string" && isOrderId(record.orderId)
      ? { type: "order", orderId: record.orderId }
      : null;
  }
  return null;
}

export function createFirestorePaymentRepository(): PaymentRepository {
  const database = getAdminFirestore();
  const payments = database.collection(COLLECTIONS.payments);
  const orders = database.collection(COLLECTIONS.orders);

  return {
    async save(payment: PaymentRecord): Promise<void> {
      await payments.doc(payment.merchantOid).create(payment);
    },

    async markFailed(merchantOid: string, now: string): Promise<void> {
      await database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(payments.doc(merchantOid));
        const payment = parsePayment(merchantOid, snapshot.data());
        if (!payment || payment.status === "succeeded") return;
        transaction.update(snapshot.ref, { status: "failed", updatedAt: now });
      });
    },

    async accessOrder(orderId: string, userId: string): Promise<OrderAccess> {
      if (!isOrderId(orderId) || !isViewerId(userId)) return { kind: "missing" };
      const snapshot = await orders.doc(orderId).get();
      const order = parseOrder(orderId, snapshot.data());
      if (!order) return { kind: "missing" };
      if (order.userId !== userId) return { kind: "foreign" };
      return { kind: "own", record: order };
    },

    async readOrder(orderId: string): Promise<OrderRecord | null> {
      if (!isOrderId(orderId)) return null;
      const snapshot = await orders.doc(orderId).get();
      return parseOrder(orderId, snapshot.data());
    },

    async applyCallback(input): Promise<CallbackDecision> {
      return database.runTransaction(async (transaction) => {
        const paymentSnap = await transaction.get(payments.doc(input.merchantOid));
        const payment = parsePayment(input.merchantOid, paymentSnap.data());
        if (payment?.type === "wallet_topup") {
          const ledgerRef = database.collection(COLLECTIONS.walletTransactions).doc(topupLedgerId(payment.merchantOid));
          const walletRef = database.collection(COLLECTIONS.wallets).doc(payment.userId);
          const ledgerSnap = await transaction.get(ledgerRef);
          const walletSnap = await transaction.get(walletRef);
          const ledger = ledgerSnap.exists ? parseLedger(ledgerRef.id, ledgerSnap.data()) : null;
          const wallet = walletSnap.exists ? parseWallet(payment.userId, walletSnap.data()) : null;
          if ((ledgerSnap.exists && !ledger) || (walletSnap.exists && !wallet)) {
            throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "wallet_unreadable");
          }
          const next = applyTopup({
            payment,
            wallet,
            ledger,
            outcome: input.outcome,
            paymentAmountMinor: input.paymentAmountMinor,
            totalAmountMinor: input.totalAmountMinor,
            now: input.now,
          });
          if (next.kind === "credited") {
            transaction.update(paymentSnap.ref, { status: next.payment.status, updatedAt: next.payment.updatedAt });
            transaction.set(walletRef, walletDocument(next.wallet));
            transaction.create(ledgerRef, ledgerDocument(next.ledger));
            return { type: "succeeded", orderId: null, purpose: "wallet_topup" } satisfies CallbackDecision;
          }
          if (next.kind === "failed") {
            transaction.update(paymentSnap.ref, { status: next.payment.status, updatedAt: next.payment.updatedAt });
            return { type: "failed", orderId: null, purpose: "wallet_topup" } satisfies CallbackDecision;
          }
          if (next.kind === "duplicate") {
            if (next.payment.status !== payment.status) {
              transaction.update(paymentSnap.ref, { status: next.payment.status, updatedAt: next.payment.updatedAt });
            }
            return { type: "duplicate", orderId: null, purpose: "wallet_topup" } satisfies CallbackDecision;
          }
          if (next.kind === "mismatch") return { type: "mismatch", orderId: null } satisfies CallbackDecision;
          return { type: "missing" } satisfies CallbackDecision;
        }

        const orderSnap = payment?.orderId ? await transaction.get(orders.doc(payment.orderId)) : null;
        const order = payment?.orderId && orderSnap ? parseOrder(payment.orderId, orderSnap.data()) : null;
        const next = decideCallback({
          payment,
          order,
          outcome: input.outcome,
          paymentAmountMinor: input.paymentAmountMinor,
          totalAmountMinor: input.totalAmountMinor,
          now: input.now,
        });
        if (next.payment && payment && next.payment.status !== payment.status) {
          transaction.update(paymentSnap.ref, { status: next.payment.status, updatedAt: next.payment.updatedAt });
        }
        if (next.order && order && orderSnap && next.order.status !== order.status) {
          transaction.update(orderSnap.ref, { status: next.order.status, updatedAt: next.order.updatedAt });
        }
        return next.decision;
      });
    },

    async claimPaidOrder(orderId: string, now: string): Promise<"claimed" | "duplicate" | "not_payable"> {
      if (!isOrderId(orderId)) return "not_payable";
      return database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(orders.doc(orderId));
        const order = parseOrder(orderId, snapshot.data());
        const next = decideSubmitClaim(order, now);
        if (next.order && order && next.order.status !== order.status) {
          transaction.update(snapshot.ref, { status: next.order.status, updatedAt: next.order.updatedAt });
        }
        return next.result;
      });
    },
  };
}
