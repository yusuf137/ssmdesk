import type { OrderRecord } from "@/lib/orders/repository";
import type { OrderStatus } from "@/lib/orders/status";

export type PaymentStatus = "initiated" | "succeeded" | "failed";

export type PaymentPurpose = "wallet_topup" | "order";

export type PaymentRecord = {
  userId: string;
  provider: "paytr";
  type: PaymentPurpose;
  merchantOid: string;
  amountMinor: number;
  currency: "TRY";
  status: PaymentStatus;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CallbackDecision =
  | { type: "succeeded"; orderId: string | null; purpose: PaymentPurpose }
  | { type: "failed"; orderId: string | null; purpose: PaymentPurpose }
  | { type: "duplicate"; orderId: string | null; purpose: PaymentPurpose }
  | { type: "mismatch"; orderId: string | null }
  | { type: "missing" };

const FULFILLED: ReadonlySet<OrderStatus> = new Set([
  "paid",
  "checking_provider_balance",
  "awaiting_provider_funds",
  "submitting",
  "submission_unknown",
  "in_progress",
  "completed",
  "partial",
  "cancel_requested",
  "cancel_processing",
  "cancel_pending_settlement",
  "cancelled",
  "failed",
  "refunded",
]);

export function decideCallback(input: {
  payment: PaymentRecord | null;
  order: OrderRecord | null;
  outcome: "success" | "failed";
  paymentAmountMinor: number;
  totalAmountMinor: number;
  now: string;
}): { decision: CallbackDecision; payment: PaymentRecord | null; order: OrderRecord | null } {
  const payment = input.payment;
  const order = input.order;
  if (
    !payment ||
    payment.type !== "order" ||
    !payment.orderId ||
    !order ||
    payment.orderId !== order.id ||
    payment.userId !== order.userId
  ) {
    return { decision: { type: "missing" }, payment, order };
  }

  const principalChanged =
    payment.amountMinor !== order.salePriceMinor ||
    input.paymentAmountMinor !== order.salePriceMinor ||
    !Number.isSafeInteger(input.totalAmountMinor) ||
    input.totalAmountMinor < order.salePriceMinor;
  if (principalChanged) {
    return { decision: { type: "mismatch", orderId: order.id }, payment, order };
  }

  if (payment.status === "succeeded" || (FULFILLED.has(order.status) && input.outcome === "failed")) {
    return { decision: { type: "duplicate", orderId: order.id, purpose: "order" }, payment, order };
  }
  if (input.outcome === "failed" && payment.status === "failed") {
    return { decision: { type: "duplicate", orderId: order.id, purpose: "order" }, payment, order };
  }

  if (input.outcome === "failed") {
    if (order.status !== "pending_payment") {
      return { decision: { type: "duplicate", orderId: order.id, purpose: "order" }, payment, order };
    }
    return {
      decision: { type: "failed", orderId: order.id, purpose: "order" },
      payment: { ...payment, status: "failed", updatedAt: input.now },
      order,
    };
  }

  if (order.status !== "pending_payment") {
    return {
      decision: { type: "duplicate", orderId: order.id, purpose: "order" },
      payment: payment.status === "initiated" ? { ...payment, status: "succeeded", updatedAt: input.now } : payment,
      order,
    };
  }

  return {
    decision: { type: "succeeded", orderId: order.id, purpose: "order" },
    payment: { ...payment, status: "succeeded", updatedAt: input.now },
    order: { ...order, status: "paid", updatedAt: input.now },
  };
}

export function decideSubmitClaim(
  order: OrderRecord | null,
  now: string,
): { result: "claimed" | "duplicate" | "not_payable"; order: OrderRecord | null } {
  if (!order) return { result: "not_payable", order };
  if (order.status === "submitting") return { result: "duplicate", order };
  if (order.status !== "paid") return { result: "not_payable", order };
  return { result: "claimed", order: { ...order, status: "submitting", updatedAt: now } };
}
