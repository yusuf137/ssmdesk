import type { PaymentRepository } from "@/lib/payments/repository";

export async function submitPaidOrder(
  orderId: string,
  payments: PaymentRepository,
  now = new Date().toISOString(),
): Promise<"claimed" | "duplicate" | "not_payable"> {
  return payments.claimPaidOrder(orderId, now);
}
