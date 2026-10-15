import "server-only";

import { COLLECTIONS } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { orderDocumentId } from "@/lib/orders/id";
import { parseOrder } from "@/lib/orders/firestore-repository";
import { orderDocument, type NewOrder, type OrderRecord } from "@/lib/orders/repository";
import { applyOrderDebit, insufficientBalance } from "@/lib/wallet/apply";
import { ledgerDocument, parseLedger, parseWallet, walletDocument } from "@/lib/wallet/documents";
import { debitLedgerId } from "@/lib/wallet/types";

export async function placePaidOrderFirestore(
  input: NewOrder,
  now = new Date().toISOString(),
): Promise<{ record: OrderRecord; created: boolean }> {
  const database = getAdminFirestore();
  const orderId = orderDocumentId(input.userId, input.idempotencyKey);
  const orderRef = database.collection(COLLECTIONS.orders).doc(orderId);
  const privateRef = database.collection(COLLECTIONS.orderPrivate).doc(orderId);
  const walletRef = database.collection(COLLECTIONS.wallets).doc(input.userId);
  const ledgerRef = database.collection(COLLECTIONS.walletTransactions).doc(debitLedgerId(orderId));

  return database.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const ledgerSnap = await transaction.get(ledgerRef);
    const walletSnap = await transaction.get(walletRef);
    const existingOrder = orderSnap.exists ? parseOrder(orderId, orderSnap.data()) : null;
    if (orderSnap.exists && !existingOrder) {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "order_unreadable");
    }
    const existingLedger = ledgerSnap.exists ? parseLedger(ledgerRef.id, ledgerSnap.data()) : null;
    if (ledgerSnap.exists && !existingLedger) {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "ledger_unreadable");
    }
    const wallet = walletSnap.exists ? parseWallet(input.userId, walletSnap.data()) : null;
    if (walletSnap.exists && !wallet) {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "wallet_unreadable");
    }

    const next = applyOrderDebit({
      existingOrder,
      existingLedger,
      wallet,
      draft: input,
      orderId,
      now,
    });
    if (next.kind === "foreign") throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
    if (next.kind === "conflict") {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "order_debit_conflict");
    }
    if (next.kind === "insufficient") throw insufficientBalance();
    if (next.kind === "replay") return { record: next.order, created: false };

    transaction.set(orderRef, orderDocument(next.order));
    transaction.set(privateRef, {
      userId: next.order.userId,
      providerCostMinor: input.providerCostMinor,
    });
    transaction.set(walletRef, walletDocument(next.wallet));
    transaction.create(ledgerRef, ledgerDocument(next.ledger));
    return { record: next.order, created: true };
  });
}
