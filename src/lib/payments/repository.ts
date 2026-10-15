import type { OrderAccess, OrderRecord } from "@/lib/orders/repository";
import type { CallbackDecision, PaymentRecord } from "@/lib/payments/record";

export type PaymentRepository = {
  save(payment: PaymentRecord): Promise<void>;
  markFailed(merchantOid: string, now: string): Promise<void>;
  accessOrder(orderId: string, userId: string): Promise<OrderAccess>;
  applyCallback(input: {
    merchantOid: string;
    outcome: "success" | "failed";
    paymentAmountMinor: number;
    totalAmountMinor: number;
    now: string;
  }): Promise<CallbackDecision>;
  claimPaidOrder(orderId: string, now: string): Promise<"claimed" | "duplicate" | "not_payable">;
  readOrder(orderId: string): Promise<OrderRecord | null>;
};
