import { buildUserBasket } from "@/lib/payments/paytr/basket";
import type { PaytrConfig } from "@/lib/payments/paytr/types";
import { createPaytrToken } from "@/lib/payments/paytr/hash";

const TOKEN_URL = "https://www.paytr.com/odeme/api/get-token";
const IFRAME_ORIGIN = "https://www.paytr.com/odeme/guvenli/";
const TOKEN_PATTERN = /^[A-Za-z0-9]{8,512}$/;

export type IframeTokenInput = {
  config: PaytrConfig;
  userIp: string;
  merchantOid: string;
  email: string;
  paymentAmountMinor: number;
  basketName: string;
  customer: { fullName: string; phone: string; address: string };
};

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export async function createIframeToken(
  input: IframeTokenInput,
  fetchImpl: FetchImpl = fetch,
): Promise<{ token: string; iframeUrl: string }> {
  const paymentAmount = String(input.paymentAmountMinor);
  const userBasket = buildUserBasket(input.basketName, input.paymentAmountMinor);
  if (!input.customer.fullName || !input.customer.phone || !input.customer.address) {
    throw new Error("paytr_token_failed");
  }
  const paytrToken = createPaytrToken({
    merchantId: input.config.merchantId,
    userIp: input.userIp,
    merchantOid: input.merchantOid,
    email: input.email,
    paymentAmount,
    userBasket,
    noInstallment: input.config.noInstallment,
    maxInstallment: input.config.maxInstallment,
    currency: "TL",
    testMode: input.config.testMode,
    merchantSalt: input.config.merchantSalt,
    merchantKey: input.config.merchantKey,
  });

  const body = new URLSearchParams({
    merchant_id: input.config.merchantId,
    user_ip: input.userIp,
    merchant_oid: input.merchantOid,
    email: input.email,
    payment_amount: paymentAmount,
    paytr_token: paytrToken,
    user_basket: userBasket,
    no_installment: input.config.noInstallment,
    max_installment: input.config.maxInstallment,
    user_name: input.customer.fullName.slice(0, 60),
    user_address: input.customer.address.slice(0, 400),
    user_phone: input.customer.phone,
    merchant_ok_url: `${input.config.appBaseUrl}/payment/success`,
    merchant_fail_url: `${input.config.appBaseUrl}/payment/failed`,
    timeout_limit: input.config.timeoutLimit,
    currency: "TL",
    test_mode: input.config.testMode,
    debug_on: "0",
    lang: "tr",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new Error("paytr_token_failed");
    const payload: unknown = await response.json();
    const token = readToken(payload);
    if (!token) throw new Error("paytr_token_failed");
    return { token, iframeUrl: `${IFRAME_ORIGIN}${token}` };
  } catch (error) {
    if (error instanceof Error && error.message === "paytr_token_failed") throw error;
    throw new Error("paytr_token_failed");
  } finally {
    clearTimeout(timeout);
  }
}

function readToken(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("status" in payload) || payload.status !== "success") return null;
  if (!("token" in payload) || typeof payload.token !== "string") return null;
  return TOKEN_PATTERN.test(payload.token) ? payload.token : null;
}
