import { isOrderId, isViewerId } from "@/lib/orders/id";
import type { LedgerEntry, LedgerType, WalletRecord } from "@/lib/wallet/types";

const LEDGER_TYPES = new Set<LedgerType>(["topup", "order_debit", "refund", "admin_adjustment"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minor(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseWallet(userId: string, data: unknown): WalletRecord | null {
  if (!isViewerId(userId) || !isRecord(data)) return null;
  if (data.userId !== userId || data.currency !== "TRY") return null;
  const balanceMinor = minor(data.balanceMinor);
  if (balanceMinor === null) return null;
  if (typeof data.createdAt !== "string" || data.createdAt.length === 0 || data.createdAt.length > 40) return null;
  if (typeof data.updatedAt !== "string" || data.updatedAt.length === 0 || data.updatedAt.length > 40) return null;
  return {
    userId,
    balanceMinor,
    currency: "TRY",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function parseLedger(id: string, data: unknown): LedgerEntry | null {
  if (!/^[a-z0-9_]{8,96}$/.test(id) || !isRecord(data)) return null;
  if (typeof data.userId !== "string" || !isViewerId(data.userId)) return null;
  if (typeof data.type !== "string" || !LEDGER_TYPES.has(data.type as LedgerType)) return null;
  const amountMinor = minor(data.amountMinor);
  const balanceBeforeMinor = minor(data.balanceBeforeMinor);
  const balanceAfterMinor = minor(data.balanceAfterMinor);
  if (amountMinor === null || amountMinor <= 0 || balanceBeforeMinor === null || balanceAfterMinor === null) return null;
  if (data.currency !== "TRY") return null;
  if (!(data.paymentId === null || (typeof data.paymentId === "string" && /^[a-z0-9]{8,64}$/.test(data.paymentId)))) {
    return null;
  }
  if (!(data.orderId === null || (typeof data.orderId === "string" && isOrderId(data.orderId)))) return null;
  if (typeof data.referenceId !== "string" || data.referenceId.length === 0 || data.referenceId.length > 80) return null;
  if (typeof data.description !== "string" || data.description.length === 0 || data.description.length > 120) return null;
  if (typeof data.createdAt !== "string" || data.createdAt.length === 0 || data.createdAt.length > 40) return null;
  return {
    id,
    userId: data.userId,
    type: data.type as LedgerType,
    amountMinor,
    currency: "TRY",
    balanceBeforeMinor,
    balanceAfterMinor,
    paymentId: data.paymentId,
    orderId: data.orderId,
    referenceId: data.referenceId,
    description: data.description,
    createdAt: data.createdAt,
  };
}

export function walletDocument(wallet: WalletRecord): WalletRecord {
  return {
    userId: wallet.userId,
    balanceMinor: wallet.balanceMinor,
    currency: "TRY",
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

export function ledgerDocument(entry: LedgerEntry): Omit<LedgerEntry, "id"> {
  return {
    userId: entry.userId,
    type: entry.type,
    amountMinor: entry.amountMinor,
    currency: "TRY",
    balanceBeforeMinor: entry.balanceBeforeMinor,
    balanceAfterMinor: entry.balanceAfterMinor,
    paymentId: entry.paymentId,
    orderId: entry.orderId,
    referenceId: entry.referenceId,
    description: entry.description,
    createdAt: entry.createdAt,
  };
}
