import "server-only";

import { COLLECTIONS, WALLET_LIST_CAP, WALLET_PAGE_SIZE } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { writeAuditLog } from "@/lib/logging/audit";
import { isViewerId } from "@/lib/orders/id";
import { ledgerDocument, parseLedger, parseWallet, walletDocument } from "@/lib/wallet/documents";
import { normalizeBillingProfile, refundReason } from "@/lib/wallet/profile";
import { pageLedger, toPublicLedger, type PublicLedgerEntry } from "@/lib/wallet/public";
import { applyAmountRefund, applyRefund } from "@/lib/wallet/apply";
import { debitLedgerId, refundLedgerId, type BillingProfile } from "@/lib/wallet/types";
import { parseOrder } from "@/lib/orders/firestore-repository";

export async function readWalletBalance(userId: string): Promise<{ balanceMinor: number; currency: "TRY" }> {
  if (!isViewerId(userId)) return { balanceMinor: 0, currency: "TRY" };
  const snapshot = await getAdminFirestore().collection(COLLECTIONS.wallets).doc(userId).get();
  if (!snapshot.exists) return { balanceMinor: 0, currency: "TRY" };
  const wallet = parseWallet(userId, snapshot.data());
  if (!wallet) throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "wallet_unreadable");
  return { balanceMinor: wallet.balanceMinor, currency: "TRY" };
}

export async function readWalletTransactions(
  userId: string,
  page: number,
): Promise<{ transactions: PublicLedgerEntry[]; total: number; page: number; pageCount: number; pageSize: number }> {
  if (!isViewerId(userId)) {
    return { transactions: [], total: 0, page, pageCount: 0, pageSize: WALLET_PAGE_SIZE };
  }
  const snapshot = await getAdminFirestore()
    .collection(COLLECTIONS.walletTransactions)
    .where("userId", "==", userId)
    .limit(WALLET_LIST_CAP)
    .get();
  const entries = snapshot.docs
    .map((document) => parseLedger(document.id, document.data()))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.userId === userId)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
  const listed = pageLedger(entries, page);
  return {
    transactions: listed.entries.map((entry) => toPublicLedger(entry)),
    total: listed.total,
    page: listed.page,
    pageCount: listed.pageCount,
    pageSize: WALLET_PAGE_SIZE,
  };
}

export async function readBillingProfile(userId: string): Promise<BillingProfile | null> {
  if (!isViewerId(userId)) return null;
  const snapshot = await getAdminFirestore().collection(COLLECTIONS.users).doc(userId).get();
  if (!snapshot.exists) return null;
  const fullName = snapshot.get("billingName");
  const phone = snapshot.get("billingPhone");
  const address = snapshot.get("billingAddress");
  if (typeof fullName !== "string" || typeof phone !== "string" || typeof address !== "string") return null;
  return normalizeBillingProfile({ fullName, phone, address });
}

export async function saveBillingProfile(input: {
  userId: string;
  email: string;
  profile: BillingProfile;
}): Promise<BillingProfile> {
  const database = getAdminFirestore();
  const ref = database.collection(COLLECTIONS.users).doc(input.userId);
  const now = new Date().toISOString();
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const fields = {
      billingName: input.profile.fullName,
      billingPhone: input.profile.phone,
      billingAddress: input.profile.address,
      updatedAt: now,
    };
    if (!snapshot.exists) {
      transaction.set(ref, {
        email: input.email,
        role: "user",
        createdAt: now,
        ...fields,
      });
      return;
    }
    transaction.update(ref, fields);
  });
  return input.profile;
}

export async function refundOrderToWallet(
  orderId: string,
  reason: string,
  now = new Date().toISOString(),
): Promise<"refunded" | "duplicate" | "not_refundable" | "missing"> {
  if (!refundReason(reason)) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  const database = getAdminFirestore();
  const orderRef = database.collection(COLLECTIONS.orders).doc(orderId);
  const debitRef = database.collection(COLLECTIONS.walletTransactions).doc(debitLedgerId(orderId));
  const refundRef = database.collection(COLLECTIONS.walletTransactions).doc(refundLedgerId(orderId));

  const outcome = await database.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const order = orderSnap.exists ? parseOrder(orderId, orderSnap.data()) : null;
    if (orderSnap.exists && !order) {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "order_unreadable");
    }
    if (!order) return { status: "missing" as const, userId: "", amountMinor: 0 };
    const walletRef = database.collection(COLLECTIONS.wallets).doc(order.userId);
    const debitSnap = await transaction.get(debitRef);
    const refundSnap = await transaction.get(refundRef);
    const walletSnap = await transaction.get(walletRef);
    const debit = debitSnap.exists ? parseLedger(debitRef.id, debitSnap.data()) : null;
    const refund = refundSnap.exists ? parseLedger(refundRef.id, refundSnap.data()) : null;
    const wallet = walletSnap.exists ? parseWallet(order.userId, walletSnap.data()) : null;
    if ((debitSnap.exists && !debit) || (refundSnap.exists && !refund) || (walletSnap.exists && !wallet)) {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "wallet_unreadable");
    }
    const next = applyRefund({ order, debit, refund, wallet, now });
    if (next.kind === "refunded") {
      transaction.update(orderRef, { status: next.order.status, updatedAt: next.order.updatedAt });
      transaction.set(walletRef, walletDocument(next.wallet));
      transaction.create(refundRef, ledgerDocument(next.ledger));
      return { status: "refunded" as const, userId: order.userId, amountMinor: order.salePriceMinor };
    }
    if (next.kind === "duplicate") {
      if (next.order.status !== order.status) {
        transaction.update(orderRef, { status: next.order.status, updatedAt: next.order.updatedAt });
      }
      return { status: "duplicate" as const, userId: order.userId, amountMinor: 0 };
    }
    return { status: next.kind, userId: order.userId, amountMinor: 0 };
  });
  if (outcome.status === "refunded") {
    await writeAuditLog({
      action: "WALLET_REFUND",
      requestId: "wallet-refund",
      endpoint: "refundOrderToWallet",
      outcome: "success",
      userId: outcome.userId,
      metadata: { orderId, amountMinor: outcome.amountMinor },
    });
  }
  return outcome.status;
}

export async function refundOrderAmountToWallet(input: {
  orderId: string;
  amountMinor: number;
  referenceId: string;
  ledgerId: string;
  nextStatus: "refunded" | "cancelled";
  now?: string;
}): Promise<"refunded" | "duplicate" | "not_refundable" | "missing"> {
  const now = input.now ?? new Date().toISOString();
  const database = getAdminFirestore();
  const orderRef = database.collection(COLLECTIONS.orders).doc(input.orderId);
  const debitRef = database.collection(COLLECTIONS.walletTransactions).doc(debitLedgerId(input.orderId));
  const refundRef = database.collection(COLLECTIONS.walletTransactions).doc(input.ledgerId);
  const fullRefundRef = database.collection(COLLECTIONS.walletTransactions).doc(refundLedgerId(input.orderId));

  const outcome = await database.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const order = orderSnap.exists ? parseOrder(input.orderId, orderSnap.data()) : null;
    if (orderSnap.exists && !order) throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "order_unreadable");
    if (!order) return { status: "missing" as const, userId: "", amountMinor: 0 };
    const walletRef = database.collection(COLLECTIONS.wallets).doc(order.userId);
    const debitSnap = await transaction.get(debitRef);
    const refundSnap = await transaction.get(refundRef);
    const fullSnap = input.ledgerId === fullRefundRef.id ? refundSnap : await transaction.get(fullRefundRef);
    const walletSnap = await transaction.get(walletRef);
    const debit = debitSnap.exists ? parseLedger(debitRef.id, debitSnap.data()) : null;
    const refund = refundSnap.exists ? parseLedger(refundRef.id, refundSnap.data()) : null;
    const fullRefund = fullSnap.exists ? parseLedger(fullRefundRef.id, fullSnap.data()) : null;
    const wallet = walletSnap.exists ? parseWallet(order.userId, walletSnap.data()) : null;
    if ((debitSnap.exists && !debit) || (refundSnap.exists && !refund) || (fullSnap.exists && !fullRefund) || (walletSnap.exists && !wallet)) {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "wallet_unreadable");
    }
    if (fullRefund && fullRefund.id !== input.ledgerId) {
      return { status: "duplicate" as const, userId: order.userId, amountMinor: 0 };
    }
    const next = applyAmountRefund({
      order,
      debit,
      existing: refund,
      wallet,
      amountMinor: input.amountMinor,
      referenceId: input.referenceId,
      ledgerId: input.ledgerId,
      nextStatus: input.nextStatus,
      now,
    });
    if (next.kind === "refunded") {
      transaction.update(orderRef, { status: next.order.status, updatedAt: next.order.updatedAt });
      transaction.set(walletRef, walletDocument(next.wallet));
      transaction.create(refundRef, ledgerDocument(next.ledger));
      return { status: "refunded" as const, userId: order.userId, amountMinor: input.amountMinor };
    }
    if (next.kind === "duplicate") {
      if (next.order.status !== order.status) {
        transaction.update(orderRef, { status: next.order.status, updatedAt: next.order.updatedAt });
      }
      return { status: "duplicate" as const, userId: order.userId, amountMinor: 0 };
    }
    return { status: "not_refundable" as const, userId: order.userId, amountMinor: 0 };
  });
  if (outcome.status === "refunded") {
    await writeAuditLog({
      action: "CANCEL_REFUND_APPLIED",
      requestId: "cancel-settlement",
      endpoint: "refundOrderAmountToWallet",
      outcome: "success",
      userId: outcome.userId,
      metadata: { orderId: input.orderId, amountMinor: outcome.amountMinor },
    });
  }
  return outcome.status;
}
