import "server-only";

import { COLLECTIONS } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { isViewerId } from "@/lib/orders/id";
import { adminAdjustmentLedgerId, applyAdminAdjustment } from "@/lib/wallet/adjust";
import { ledgerDocument, parseLedger, parseWallet, walletDocument } from "@/lib/wallet/documents";

export async function adjustWalletBalance(input: {
  targetUserId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
  now?: string;
}): Promise<{ balanceMinor: number; duplicate: boolean }> {
  if (!isViewerId(input.targetUserId)) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  const database = getAdminFirestore();
  const userRef = database.collection(COLLECTIONS.users).doc(input.targetUserId);
  const walletRef = database.collection(COLLECTIONS.wallets).doc(input.targetUserId);
  const ledgerId = adminAdjustmentLedgerId(input.targetUserId, input.idempotencyKey);
  const ledgerRef = database.collection(COLLECTIONS.walletTransactions).doc(ledgerId);
  const now = input.now ?? new Date().toISOString();

  return database.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) throw new AppError("NOT_FOUND", 404, "Kullanıcı bulunamadı.");
    const walletSnap = await transaction.get(walletRef);
    const ledgerSnap = await transaction.get(ledgerRef);
    const wallet = walletSnap.exists ? parseWallet(input.targetUserId, walletSnap.data()) : null;
    const existing = ledgerSnap.exists ? parseLedger(ledgerId, ledgerSnap.data()) : null;
    if ((walletSnap.exists && !wallet) || (ledgerSnap.exists && !existing)) {
      throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "wallet_unreadable");
    }
    const next = applyAdminAdjustment({
      targetUserId: input.targetUserId,
      amountMinor: input.amountMinor,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      wallet,
      existing,
      now,
    });
    if (next.kind === "insufficient") {
      throw new AppError("INVALID_REQUEST", 400, "Bakiye 0'ın altına düşemez.");
    }
    if (next.kind === "conflict") {
      throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    }
    if (next.kind === "duplicate") {
      return { balanceMinor: next.wallet.balanceMinor, duplicate: true };
    }
    transaction.set(walletRef, walletDocument(next.wallet));
    transaction.create(ledgerRef, ledgerDocument(next.ledger));
    return { balanceMinor: next.wallet.balanceMinor, duplicate: false };
  });
}
