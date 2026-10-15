import { createHash } from "node:crypto";

import type { LedgerEntry, WalletRecord } from "@/lib/wallet/types";

export function adminAdjustmentLedgerId(userId: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(`${userId}:${idempotencyKey}`, "utf8").digest("hex").slice(0, 40);
  return `adjust_${digest}`;
}

export type AdminAdjustmentResult =
  | { kind: "applied"; wallet: WalletRecord; ledger: LedgerEntry }
  | { kind: "duplicate"; wallet: WalletRecord; ledger: LedgerEntry }
  | { kind: "insufficient" }
  | { kind: "conflict" };

export function applyAdminAdjustment(input: {
  targetUserId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
  wallet: WalletRecord | null;
  existing: LedgerEntry | null;
  now: string;
}): AdminAdjustmentResult {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) return { kind: "conflict" };
  const before = input.wallet?.balanceMinor ?? 0;
  if (!Number.isSafeInteger(before) || before < 0) return { kind: "conflict" };
  const after = before + input.amountMinor;
  if (!Number.isSafeInteger(after)) return { kind: "conflict" };
  const magnitude = Math.abs(input.amountMinor);
  const ledgerId = adminAdjustmentLedgerId(input.targetUserId, input.idempotencyKey);
  const existing = input.existing;

  if (existing) {
    const sameEffect =
      existing.id === ledgerId &&
      existing.userId === input.targetUserId &&
      existing.type === "admin_adjustment" &&
      existing.amountMinor === magnitude &&
      existing.balanceAfterMinor - existing.balanceBeforeMinor === input.amountMinor;
    if (!sameEffect || !input.wallet) return { kind: "conflict" };
    return { kind: "duplicate", wallet: input.wallet, ledger: existing };
  }

  if (after < 0) return { kind: "insufficient" };

  const wallet: WalletRecord = {
    userId: input.targetUserId,
    balanceMinor: after,
    currency: "TRY",
    createdAt: input.wallet?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  const ledger: LedgerEntry = {
    id: ledgerId,
    userId: input.targetUserId,
    type: "admin_adjustment",
    amountMinor: magnitude,
    currency: "TRY",
    balanceBeforeMinor: before,
    balanceAfterMinor: after,
    paymentId: null,
    orderId: null,
    referenceId: input.idempotencyKey,
    description: input.reason,
    createdAt: input.now,
  };
  return { kind: "applied", wallet, ledger };
}
