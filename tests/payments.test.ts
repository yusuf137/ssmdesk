import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { handlePaytrCallback } from "../src/lib/payments/handle-callback";
import { MemoryPaymentRepository } from "../src/lib/payments/memory-repository";
import { buildUserBasket } from "../src/lib/payments/paytr/basket";
import { createPaytrToken, verifyCallbackHash } from "../src/lib/payments/paytr/hash";
import type { PaytrConfig } from "../src/lib/payments/paytr/types";
import type { PaymentRecord } from "../src/lib/payments/record";
import { submitPaidOrder } from "../src/lib/payments/submit-paid-order";
import type { OrderRecord } from "../src/lib/orders/repository";

const root = join(import.meta.dirname, "..");
const merchantKey = "test-merchant-key";
const merchantSalt = "test-merchant-salt";
const merchantOid = "p0123456789abcdef0123456789abcdef";
const orderId = "a".repeat(64);

const config: PaytrConfig = {
  merchantId: "100001",
  merchantKey,
  merchantSalt,
  testMode: "1",
  noInstallment: "0",
  maxInstallment: "0",
  timeoutLimit: "30",
  appBaseUrl: "http://localhost:3000",
};

function order(status: OrderRecord["status"] = "pending_payment"): OrderRecord {
  return {
    id: orderId,
    userId: "user-a",
    serviceId: 42,
    serviceName: "Takipci",
    category: "Instagram",
    targetUrl: "https://example.com/item",
    quantity: 1000,
    currency: "TRY",
    salePriceMinor: 1500,
    pricingRole: "user",
    pricingMultiplier: null,
    provider: "smmfull",
    providerOrderId: null,
    providerStatus: null,
    status,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
}

function legacyPayment(): PaymentRecord {
  return {
    userId: "user-a",
    provider: "paytr",
    type: "order",
    merchantOid,
    amountMinor: 1500,
    currency: "TRY",
    status: "initiated",
    orderId,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
}

function callbackHash(status: string, totalAmount: string): string {
  return createHmac("sha256", merchantKey)
    .update(`${merchantOid}${merchantSalt}${status}${totalAmount}`, "utf8")
    .digest("base64");
}

function fields(status: string, totalAmount: string, paymentAmount = "1500", hash = callbackHash(status, totalAmount)) {
  return {
    merchant_oid: merchantOid,
    status,
    total_amount: totalAmount,
    payment_amount: paymentAmount,
    hash,
    currency: "TL",
  };
}

test("paytr token matches the documented hmac fixture", () => {
  const userBasket = buildUserBasket("Takipci", 1500);
  assert.equal(userBasket, "W1siVGFraXBjaSIsIjE1LjAwIiwxXV0=");
  assert.equal(userBasket.includes("cost"), false);
  const token = createPaytrToken({
    merchantId: config.merchantId,
    userIp: "203.0.113.10",
    merchantOid,
    email: "buyer@example.com",
    paymentAmount: "1500",
    userBasket,
    noInstallment: "0",
    maxInstallment: "0",
    currency: "TL",
    testMode: "1",
    merchantSalt,
    merchantKey,
  });
  assert.equal(token, "r+e9vM0Gz5gI89ptYravv0xdaMnllfCM42xTXOB7hg4=");
  assert.equal(
    verifyCallbackHash({
      merchantOid,
      merchantSalt,
      status: "success",
      totalAmount: "1500",
      merchantKey,
      hash: "VgaIoercAmMiR75yVchjLyloy2PUreJCOcGCsk3LwKk=",
    }),
    true,
  );
});

test("legacy order callback still marks a pending order paid once", async () => {
  const payments = new MemoryPaymentRepository();
  payments.seed(order());
  payments.payments.set(merchantOid, legacyPayment());

  const first = await handlePaytrCallback({ fields: fields("success", "1500"), config, payments });
  const second = await handlePaytrCallback({ fields: fields("success", "1500"), config, payments });
  assert.equal(first.response, "OK");
  assert.equal(first.event, "PAYMENT_SUCCEEDED");
  assert.equal(second.response, "OK");
  assert.equal(second.event, "PAYMENT_CALLBACK_DUPLICATE");
  assert.equal(payments.orders.get(orderId)?.status, "paid");
  assert.equal(payments.payments.get(merchantOid)?.status, "succeeded");

  const claimed = await submitPaidOrder(orderId, payments, "2026-10-15T00:01:00.000Z");
  const again = await submitPaidOrder(orderId, payments, "2026-10-15T00:02:00.000Z");
  assert.equal(claimed, "claimed");
  assert.equal(again, "duplicate");
  assert.equal(payments.orders.get(orderId)?.status, "submitting");
});

test("parallel success callbacks pay the order once", async () => {
  const payments = new MemoryPaymentRepository();
  payments.seed(order());
  payments.payments.set(merchantOid, legacyPayment());
  const results = await Promise.all([
    handlePaytrCallback({ fields: fields("success", "1500"), config, payments }),
    handlePaytrCallback({ fields: fields("success", "1500"), config, payments }),
  ]);
  assert.equal(results.filter((result) => result.event === "PAYMENT_SUCCEEDED").length, 1);
  assert.equal(results.every((result) => result.response === "OK"), true);
  assert.equal(payments.orders.get(orderId)?.status, "paid");
});

test("invalid hash does not change the order", async () => {
  const payments = new MemoryPaymentRepository();
  payments.seed(order());
  payments.payments.set(merchantOid, legacyPayment());
  const result = await handlePaytrCallback({
    fields: fields("success", "1500", "1500", "not-the-hash"),
    config,
    payments,
  });
  assert.equal(result.response, "INVALID");
  assert.equal(result.event, "PAYMENT_CALLBACK_INVALID_HASH");
  assert.equal(payments.orders.get(orderId)?.status, "pending_payment");
  assert.equal(payments.payments.get(merchantOid)?.status, "initiated");
});

test("payment amount mismatch is rejected", async () => {
  const payments = new MemoryPaymentRepository();
  payments.seed(order());
  payments.payments.set(merchantOid, legacyPayment());
  const mismatched = await handlePaytrCallback({
    fields: fields("success", "1500", "999"),
    config,
    payments,
  });
  assert.equal(mismatched.response, "INVALID");
  assert.equal(mismatched.event, "PAYMENT_AMOUNT_MISMATCH");
  assert.equal(payments.orders.get(orderId)?.status, "pending_payment");

  const higherCollected = await handlePaytrCallback({
    fields: fields("success", "1800", "1500", callbackHash("success", "1800")),
    config,
    payments,
  });
  assert.equal(higherCollected.response, "OK");
  assert.equal(higherCollected.event, "PAYMENT_SUCCEEDED");
});

test("failed callback leaves the order pending", async () => {
  const payments = new MemoryPaymentRepository();
  payments.seed(order());
  payments.payments.set(merchantOid, legacyPayment());
  const result = await handlePaytrCallback({
    fields: fields("failed", "1500"),
    config,
    payments,
  });
  assert.equal(result.response, "OK");
  assert.equal(result.event, "PAYMENT_FAILED");
  assert.equal(payments.orders.get(orderId)?.status, "pending_payment");
  assert.equal(payments.payments.get(merchantOid)?.status, "failed");
  assert.equal(await submitPaidOrder(orderId, payments), "not_payable");
});

test("callback route does not require a session or submit the provider order", () => {
  const callback = readFileSync(join(root, "src/app/api/payments/paytr/callback/route.ts"), "utf8");
  const handler = readFileSync(join(root, "src/lib/payments/handle-callback.ts"), "utf8");
  const submit = readFileSync(join(root, "src/lib/payments/submit-paid-order.ts"), "utf8");
  const rules = readFileSync(join(root, "firestore.rules"), "utf8");
  assert.equal(callback.includes("requireApiUser"), false);
  assert.equal(callback.includes("readAuthenticatedUser"), false);
  assert.equal(callback.includes("submitPaidOrder"), false);
  assert.equal(callback.includes('text/plain; charset=utf-8'), true);
  assert.equal(callback.includes('? "OK"'), true);
  assert.equal(handler.includes("submitPaidOrder"), false);
  assert.equal(handler.includes("createOrder("), false);
  assert.equal(handler.includes("action=add"), false);
  assert.equal(submit.includes("createOrder("), false);
  assert.equal(submit.includes("action=add"), false);
  const paymentsRule = rules.slice(rules.indexOf("match /payments/"), rules.indexOf("match /wallets/"));
  const walletRule = rules.slice(rules.indexOf("match /wallets/"), rules.indexOf("match /walletTransactions/"));
  const ledgerRule = rules.slice(rules.indexOf("match /walletTransactions/"), rules.indexOf("match /{document=**}"));
  assert.match(paymentsRule, /allow read, write: if false/);
  assert.match(walletRule, /allow read, write: if false/);
  assert.match(ledgerRule, /allow read, write: if false/);
  assert.equal(readFileSync(join(root, "src/components/orders/order-detail.tsx"), "utf8").includes("PayTR ile Öde"), false);
});
