import { mapPaytrStatus, verifyCallbackHash } from "@/lib/payments/paytr/hash";
import type { PaytrConfig } from "@/lib/payments/paytr/types";
import type { CallbackDecision } from "@/lib/payments/record";
import type { PaymentRepository } from "@/lib/payments/repository";

export type CallbackResult =
  | {
      response: "OK";
      event:
        | "PAYMENT_SUCCEEDED"
        | "PAYMENT_FAILED"
        | "PAYMENT_CALLBACK_DUPLICATE"
        | "WALLET_TOPUP_SUCCEEDED"
        | "WALLET_TOPUP_FAILED"
        | "WALLET_TOPUP_DUPLICATE";
      orderId: string | null;
    }
  | {
      response: "INVALID";
      event: "PAYMENT_CALLBACK_INVALID_HASH" | "PAYMENT_AMOUNT_MISMATCH" | "PAYMENT_CALLBACK_REJECTED";
      orderId?: string | null;
    };

const AMOUNT = /^(0|[1-9]\d*)$/;
const OID = /^[a-z0-9]{8,64}$/;

export async function handlePaytrCallback(input: {
  fields: Record<string, string>;
  config: Pick<PaytrConfig, "merchantKey" | "merchantSalt">;
  payments: PaymentRepository;
  now?: string;
}): Promise<CallbackResult> {
  const merchantOid = input.fields.merchant_oid ?? "";
  const status = input.fields.status ?? "";
  const totalAmount = input.fields.total_amount ?? "";
  const hash = input.fields.hash ?? "";
  const paymentAmount = input.fields.payment_amount ?? "";
  if (!OID.test(merchantOid) || !status || !AMOUNT.test(totalAmount) || !hash) {
    return { response: "INVALID", event: "PAYMENT_CALLBACK_REJECTED" };
  }

  const validHash = verifyCallbackHash({
    merchantOid,
    merchantSalt: input.config.merchantSalt,
    status,
    totalAmount,
    merchantKey: input.config.merchantKey,
    hash,
  });
  if (!validHash) {
    return { response: "INVALID", event: "PAYMENT_CALLBACK_INVALID_HASH" };
  }

  const outcome = mapPaytrStatus(status);
  const currency = input.fields.currency ?? "";
  const currencyOk = currency === "" || currency === "TL" || currency === "TRY";
  if (!outcome || !AMOUNT.test(paymentAmount) || !currencyOk) {
    return { response: "INVALID", event: "PAYMENT_AMOUNT_MISMATCH", orderId: undefined };
  }

  const decision: CallbackDecision = await input.payments.applyCallback({
    merchantOid,
    outcome,
    paymentAmountMinor: Number(paymentAmount),
    totalAmountMinor: Number(totalAmount),
    now: input.now ?? new Date().toISOString(),
  });

  if (decision.type === "succeeded") {
    return {
      response: "OK",
      event: decision.purpose === "wallet_topup" ? "WALLET_TOPUP_SUCCEEDED" : "PAYMENT_SUCCEEDED",
      orderId: decision.orderId,
    };
  }
  if (decision.type === "failed") {
    return {
      response: "OK",
      event: decision.purpose === "wallet_topup" ? "WALLET_TOPUP_FAILED" : "PAYMENT_FAILED",
      orderId: decision.orderId,
    };
  }
  if (decision.type === "duplicate") {
    return {
      response: "OK",
      event: decision.purpose === "wallet_topup" ? "WALLET_TOPUP_DUPLICATE" : "PAYMENT_CALLBACK_DUPLICATE",
      orderId: decision.orderId,
    };
  }
  if (decision.type === "mismatch") {
    return { response: "INVALID", event: "PAYMENT_AMOUNT_MISMATCH", orderId: decision.orderId };
  }
  return { response: "INVALID", event: "PAYMENT_CALLBACK_REJECTED" };
}
