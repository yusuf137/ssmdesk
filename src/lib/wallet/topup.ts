import { randomBytes } from "node:crypto";

import { AppError } from "@/lib/http/errors";
import { createIframeToken } from "@/lib/payments/paytr/iframe";
import type { PaytrConfig } from "@/lib/payments/paytr/types";
import type { PaymentRecord } from "@/lib/payments/record";
import type { PaymentRepository } from "@/lib/payments/repository";
import { assertCustomTopupMinor } from "@/lib/wallet/amount";
import type { BillingProfile } from "@/lib/wallet/types";
import { findTopupPackage } from "@/lib/wallet/types";

function packageAmount(packageId: string): number {
  const selected = findTopupPackage(packageId);
  if (!selected) {
    throw new AppError("INVALID_PACKAGE", 400, "Geçersiz bakiye paketi.");
  }
  return selected.amountMinor;
}

const IP_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^[0-9a-fA-F:]{2,45}$/;

export async function startWalletTopup(input: {
  user: { uid: string; email: string } | null;
  packageId?: string;
  customAmountMinor?: number;
  profile: BillingProfile | null;
  userIp: string | null;
  config: PaytrConfig;
  payments: PaymentRepository;
  now?: string;
  merchantOid?: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<{ token: string; iframeUrl: string; merchantOid: string; amountMinor: number }> {
  if (!input.user?.uid || !input.user.email) {
    throw new AppError("UNAUTHENTICATED", 401, "Oturum doğrulanamadı.");
  }
  const hasPackage = input.packageId !== undefined;
  const hasCustom = input.customAmountMinor !== undefined;
  if (hasPackage === hasCustom) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  const amountMinor = hasPackage ? packageAmount(input.packageId ?? "") : assertCustomTopupMinor(input.customAmountMinor ?? Number.NaN);
  if (!input.profile) {
    throw new AppError("BILLING_PROFILE_REQUIRED", 409, "Ödeme için ad, telefon ve adres bilgisi gerekli.");
  }
  if (!input.userIp || !IP_PATTERN.test(input.userIp)) {
    throw new AppError("PAYMENT_IP_UNAVAILABLE", 400, "Ödeme için istemci adresi doğrulanamadı.");
  }

  const now = input.now ?? new Date().toISOString();
  const merchantOid = input.merchantOid ?? `p${randomBytes(16).toString("hex")}`;
  const payment: PaymentRecord = {
    userId: input.user.uid,
    provider: "paytr",
    type: "wallet_topup",
    merchantOid,
    amountMinor,
    currency: "TRY",
    status: "initiated",
    orderId: null,
    createdAt: now,
    updatedAt: now,
  };
  await input.payments.save(payment);

  try {
    const issued = await createIframeToken(
      {
        config: input.config,
        userIp: input.userIp,
        merchantOid,
        email: input.user.email,
        paymentAmountMinor: amountMinor,
        basketName: "Bakiye yükleme",
        customer: input.profile,
      },
      input.fetchImpl,
    );
    return { ...issued, merchantOid, amountMinor };
  } catch {
    await input.payments.markFailed(merchantOid, now);
    throw new AppError("PAYMENT_UNAVAILABLE", 503, "Ödeme başlatılamadı.", "paytr_token_failed");
  }
}
