import { AppError } from "@/lib/http/errors";
import { buildOrderRecord, type NewOrder, type OrderRecord } from "@/lib/orders/repository";
import type { PaymentRecord } from "@/lib/payments/record";
import {
  debitLedgerId,
  refundLedgerId,
  topupLedgerId,
  type LedgerEntry,
  type WalletRecord,
} from "@/lib/wallet/types";

const REFUNDABLE = new Set<OrderRecord["status"]>([
  "paid",
  "checking_provider_balance",
  "awaiting_provider_funds",
  "failed",
]);

export type TopupApplyResult =
  | { kind: "credited"; payment: PaymentRecord; wallet: WalletRecord; ledger: LedgerEntry }
  | { kind: "duplicate"; payment: PaymentRecord }
  | { kind: "failed"; payment: PaymentRecord }
  | { kind: "mismatch" }
  | { kind: "missing" };

export type DebitApplyResult =
  | { kind: "replay"; order: OrderRecord }
  | { kind: "foreign" }
  | { kind: "insufficient" }
  | { kind: "conflict" }
  | { kind: "created"; order: OrderRecord; wallet: WalletRecord; ledger: LedgerEntry };

export type RefundApplyResult =
  | { kind: "missing" }
  | { kind: "duplicate"; order: OrderRecord }
  | { kind: "not_refundable" }
  | { kind: "refunded"; order: OrderRecord; wallet: WalletRecord; ledger: LedgerEntry };

function addMinor(left: number, right: number): number | null {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || right < 0) return null;
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

export function applyTopup(input: {
  payment: PaymentRecord | null;
  wallet: WalletRecord | null;
  ledger: LedgerEntry | null;
  outcome: "success" | "failed";
  paymentAmountMinor: number;
  totalAmountMinor: number;
  now: string;
}): TopupApplyResult {
  const payment = input.payment;
  if (!payment || payment.type !== "wallet_topup" || payment.orderId !== null) return { kind: "missing" };
  const expectedLedgerId = topupLedgerId(payment.merchantOid);
  if (input.ledger && input.ledger.id !== expectedLedgerId) return { kind: "mismatch" };
  if (payment.status === "succeeded" || input.ledger) {
    return {
      kind: "duplicate",
      payment:
        payment.status === "succeeded"
          ? payment
          : { ...payment, status: "succeeded", updatedAt: input.now },
    };
  }

  const amountMatches =
    Number.isSafeInteger(input.paymentAmountMinor) &&
    Number.isSafeInteger(input.totalAmountMinor) &&
    input.paymentAmountMinor === payment.amountMinor &&
    input.totalAmountMinor >= payment.amountMinor &&
    payment.currency === "TRY";
  if (!amountMatches) return { kind: "mismatch" };

  if (input.outcome === "failed") {
    if (payment.status === "failed") return { kind: "duplicate", payment };
    return { kind: "failed", payment: { ...payment, status: "failed", updatedAt: input.now } };
  }

  const before = input.wallet?.balanceMinor ?? 0;
  const after = addMinor(before, payment.amountMinor);
  if (after === null || (input.wallet && input.wallet.userId !== payment.userId)) return { kind: "mismatch" };
  const wallet: WalletRecord = {
    userId: payment.userId,
    balanceMinor: after,
    currency: "TRY",
    createdAt: input.wallet?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  const ledger: LedgerEntry = {
    id: expectedLedgerId,
    userId: payment.userId,
    type: "topup",
    amountMinor: payment.amountMinor,
    currency: "TRY",
    balanceBeforeMinor: before,
    balanceAfterMinor: after,
    paymentId: payment.merchantOid,
    orderId: null,
    referenceId: payment.merchantOid,
    description: "Bakiye yükleme",
    createdAt: input.now,
  };
  return {
    kind: "credited",
    payment: { ...payment, status: "succeeded", updatedAt: input.now },
    wallet,
    ledger,
  };
}

export function applyOrderDebit(input: {
  existingOrder: OrderRecord | null;
  existingLedger: LedgerEntry | null;
  wallet: WalletRecord | null;
  draft: NewOrder;
  orderId: string;
  now: string;
}): DebitApplyResult {
  if (input.existingOrder) {
    if (input.existingOrder.userId !== input.draft.userId) return { kind: "foreign" };
    return { kind: "replay", order: input.existingOrder };
  }
  if (input.existingLedger) return { kind: "conflict" };
  const before = input.wallet?.balanceMinor ?? 0;
  if (!Number.isSafeInteger(before) || before < input.draft.salePriceMinor) return { kind: "insufficient" };
  const after = before - input.draft.salePriceMinor;
  if (!Number.isSafeInteger(after) || after < 0) return { kind: "insufficient" };
  if (input.wallet && input.wallet.userId !== input.draft.userId) return { kind: "conflict" };

  const order = buildOrderRecord(input.orderId, input.draft, input.now, "paid");
  const wallet: WalletRecord = {
    userId: input.draft.userId,
    balanceMinor: after,
    currency: "TRY",
    createdAt: input.wallet?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  const ledger: LedgerEntry = {
    id: debitLedgerId(input.orderId),
    userId: input.draft.userId,
    type: "order_debit",
    amountMinor: input.draft.salePriceMinor,
    currency: "TRY",
    balanceBeforeMinor: before,
    balanceAfterMinor: after,
    paymentId: null,
    orderId: input.orderId,
    referenceId: input.orderId,
    description: "Sipariş",
    createdAt: input.now,
  };
  return { kind: "created", order, wallet, ledger };
}

export function applyRefund(input: {
  order: OrderRecord | null;
  debit: LedgerEntry | null;
  refund: LedgerEntry | null;
  wallet: WalletRecord | null;
  now: string;
}): RefundApplyResult {
  const order = input.order;
  if (!order) return { kind: "missing" };
  if (order.status === "refunded" || input.refund) {
    return {
      kind: "duplicate",
      order: order.status === "refunded" ? order : { ...order, status: "refunded", updatedAt: input.now },
    };
  }
  if (!input.debit || input.debit.type !== "order_debit" || input.debit.orderId !== order.id) {
    return { kind: "not_refundable" };
  }
  if (!REFUNDABLE.has(order.status) || input.debit.amountMinor !== order.salePriceMinor) {
    return { kind: "not_refundable" };
  }
  const before = input.wallet?.balanceMinor ?? 0;
  const after = addMinor(before, order.salePriceMinor);
  if (after === null || (input.wallet && input.wallet.userId !== order.userId)) return { kind: "not_refundable" };
  const wallet: WalletRecord = {
    userId: order.userId,
    balanceMinor: after,
    currency: "TRY",
    createdAt: input.wallet?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  const ledger: LedgerEntry = {
    id: refundLedgerId(order.id),
    userId: order.userId,
    type: "refund",
    amountMinor: order.salePriceMinor,
    currency: "TRY",
    balanceBeforeMinor: before,
    balanceAfterMinor: after,
    paymentId: null,
    orderId: order.id,
    referenceId: order.id,
    description: "İade",
    createdAt: input.now,
  };
  return {
    kind: "refunded",
    order: { ...order, status: "refunded", updatedAt: input.now },
    wallet,
    ledger,
  };
}

const CANCEL_REFUNDABLE = new Set<OrderRecord["status"]>([
  "cancel_requested",
  "cancel_processing",
  "cancel_pending_settlement",
]);

export type AmountRefundResult =
  | { kind: "duplicate"; order: OrderRecord }
  | { kind: "not_refundable" }
  | { kind: "refunded"; order: OrderRecord; wallet: WalletRecord; ledger: LedgerEntry };

export function applyAmountRefund(input: {
  order: OrderRecord | null;
  debit: LedgerEntry | null;
  existing: LedgerEntry | null;
  wallet: WalletRecord | null;
  amountMinor: number;
  referenceId: string;
  ledgerId: string;
  nextStatus: "refunded" | "cancelled";
  now: string;
}): AmountRefundResult {
  const order = input.order;
  if (!order || !input.debit || input.debit.type !== "order_debit" || input.debit.orderId !== order.id) {
    return { kind: "not_refundable" };
  }
  if (input.debit.amountMinor !== order.salePriceMinor) return { kind: "not_refundable" };
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > order.salePriceMinor) {
    return { kind: "not_refundable" };
  }
  if (input.referenceId.length === 0 || input.referenceId.length > 80 || input.ledgerId.length < 8) {
    return { kind: "not_refundable" };
  }
  if (order.status === "refunded" || input.existing) {
    if (input.existing && input.existing.amountMinor !== input.amountMinor) return { kind: "not_refundable" };
    return {
      kind: "duplicate",
      order: order.status === "refunded" ? order : { ...order, status: input.nextStatus, updatedAt: input.now },
    };
  }
  if (!CANCEL_REFUNDABLE.has(order.status)) return { kind: "not_refundable" };
  const before = input.wallet?.balanceMinor ?? 0;
  const after = addMinor(before, input.amountMinor);
  if (after === null || (input.wallet && input.wallet.userId !== order.userId)) return { kind: "not_refundable" };
  return {
    kind: "refunded",
    order: { ...order, status: input.nextStatus, updatedAt: input.now },
    wallet: {
      userId: order.userId,
      balanceMinor: after,
      currency: "TRY",
      createdAt: input.wallet?.createdAt ?? input.now,
      updatedAt: input.now,
    },
    ledger: {
      id: input.ledgerId,
      userId: order.userId,
      type: "refund",
      amountMinor: input.amountMinor,
      currency: "TRY",
      balanceBeforeMinor: before,
      balanceAfterMinor: after,
      paymentId: null,
      orderId: order.id,
      referenceId: input.referenceId,
      description: "İptal iadesi",
      createdAt: input.now,
    },
  };
}

export function insufficientBalance(): AppError {
  return new AppError("INSUFFICIENT_BALANCE", 402, "Yetersiz bakiye. Bakiye yükleyin.");
}
