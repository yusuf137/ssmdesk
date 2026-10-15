import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AppError } from "../src/lib/http/errors";
import { handlePaytrCallback } from "../src/lib/payments/handle-callback";
import { MemoryPaymentRepository } from "../src/lib/payments/memory-repository";
import { buildUserBasket } from "../src/lib/payments/paytr/basket";
import { createPaytrToken } from "../src/lib/payments/paytr/hash";
import type { PaytrConfig } from "../src/lib/payments/paytr/types";
import { placeOrder, type OrderServiceSnapshot } from "../src/lib/orders/place-order";
import { publicWalletSchema, publicLedgerSchema } from "../src/lib/wallet/public";
import { normalizeBillingProfile } from "../src/lib/wallet/profile";
import { assertCustomTopupMinor, parseTryInputToMinor } from "../src/lib/wallet/amount";
import { topupInitSchema } from "../src/lib/wallet/schema";
import { MemoryCheckout } from "../src/lib/wallet/memory-checkout";
import { startWalletTopup } from "../src/lib/wallet/topup";
import { TOPUP_PACKAGES_MINOR } from "../src/lib/wallet/types";

const root = join(import.meta.dirname, "..");
const merchantKey = "test-merchant-key";
const merchantSalt = "test-merchant-salt";
const merchantOid = "p0123456789abcdef0123456789abcdef";
const key = "11111111-1111-4111-8111-111111111111";

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

const profile = {
  fullName: "Ayşe Yılmaz",
  phone: "05551234567",
  address: "Kadıköy Moda Cad. No 10",
};

function service(salePrice = 149.9): OrderServiceSnapshot {
  return {
    id: 42,
    name: "Takipçi",
    category: "Instagram",
    salePrice,
    costPrice: 10,
    min: 100,
    max: 10_000,
  };
}

function body(quantity = 1000) {
  return {
    serviceId: 42,
    targetUrl: "https://example.com/item",
    quantity,
    idempotencyKey: key,
  };
}

function callbackHash(status: string, totalAmount: string): string {
  return createHmac("sha256", merchantKey).update(`${merchantOid}${merchantSalt}${status}${totalAmount}`, "utf8").digest("base64");
}

test("wallet defaults to zero and packages are server constants", () => {
  const wallet = new MemoryCheckout();
  assert.deepEqual(wallet.getPublicWallet("user-a"), { balanceMinor: 0, currency: "TRY" });
  assert.deepEqual(TOPUP_PACKAGES_MINOR, [50_000, 100_000, 250_000, 500_000]);
  assert.equal(publicWalletSchema.safeParse(wallet.getPublicWallet("user-a")).success, true);
});

test("topup init requires auth and a real billing profile", async () => {
  const payments = new MemoryPaymentRepository();
  await assert.rejects(
    () =>
      startWalletTopup({
        user: null,
        packageId: "p500",
        profile,
        userIp: "203.0.113.10",
        config,
        payments,
      }),
    (error: unknown) => error instanceof AppError && error.status === 401,
  );
  await assert.rejects(
    () =>
      startWalletTopup({
        user: { uid: "user-a", email: "buyer@example.com" },
        packageId: "p500",
        profile: null,
        userIp: "203.0.113.10",
        config,
        payments,
      }),
    (error: unknown) => error instanceof AppError && error.code === "BILLING_PROFILE_REQUIRED",
  );
  assert.equal(payments.payments.size, 0);
  assert.equal(normalizeBillingProfile({ fullName: "Tek", phone: "05551234567", address: profile.address }), null);
});

test("invalid package and client amount are rejected", async () => {
  assert.equal(topupInitSchema.safeParse({ packageId: "p100" }).success, false);
  assert.equal(topupInitSchema.safeParse({ packageId: "p500", amountMinor: 1 }).success, false);
  assert.equal(topupInitSchema.safeParse({ amountMinor: 50_000 }).success, false);
  const payments = new MemoryPaymentRepository();
  await assert.rejects(
    () =>
      startWalletTopup({
        user: { uid: "user-a", email: "buyer@example.com" },
        packageId: "custom",
        profile,
        userIp: "203.0.113.10",
        config,
        payments,
      }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_PACKAGE",
  );
  assert.equal(payments.payments.size, 0);
});

test("custom topup accepts only an integer minor amount inside the limits", () => {
  assert.equal(parseTryInputToMinor("49.99"), 4_999);
  assert.equal(parseTryInputToMinor("49,99"), 4_999);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: 4_999 }).success, false);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: 49.99 }).success, false);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: "5000" }).success, false);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: Number.NaN }).success, false);
  assert.throws(
    () => assertCustomTopupMinor(4_999),
    (error: unknown) => error instanceof AppError && error.publicMessage === "Minimum bakiye yükleme tutarı 50 TL.",
  );

  assert.equal(parseTryInputToMinor("50"), 5_000);
  assert.equal(parseTryInputToMinor("125.50"), 12_550);
  assert.equal(parseTryInputToMinor("999,90"), 99_990);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: 5_000 }).success, true);
  assert.equal(assertCustomTopupMinor(5_000), 5_000);

  assert.equal(parseTryInputToMinor("20.000"), 2_000_000);
  assert.equal(parseTryInputToMinor("20000"), 2_000_000);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: 2_000_000 }).success, true);
  assert.equal(assertCustomTopupMinor(2_000_000), 2_000_000);

  assert.equal(parseTryInputToMinor("20.000,01"), 2_000_001);
  assert.equal(parseTryInputToMinor("20000.01"), 2_000_001);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: 2_000_001 }).success, false);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: 20000.01 }).success, false);
  assert.throws(
    () => assertCustomTopupMinor(2_000_001),
    (error: unknown) => error instanceof AppError && error.publicMessage === "Maksimum bakiye yükleme tutarı 20.000 TL.",
  );

  assert.equal(topupInitSchema.safeParse({ packageId: "p500", customAmountMinor: 5_000 }).success, false);
  assert.equal(topupInitSchema.safeParse({ customAmountMinor: true }).success, false);
  assert.equal(topupInitSchema.safeParse({ amount: "50" }).success, false);
});

test("custom topup stores the verified amount and a duplicate callback does not credit again", async () => {
  const payments = new MemoryPaymentRepository();
  const amountMinor = 12_550;
  await startWalletTopup({
    user: { uid: "user-a", email: "buyer@example.com" },
    customAmountMinor: amountMinor,
    profile,
    userIp: "203.0.113.10",
    config,
    payments,
    merchantOid,
    fetchImpl: async (_url, init) => {
      const params = new URLSearchParams(String(init.body));
      assert.equal(params.get("payment_amount"), "12550");
      return Response.json({ status: "success", token: "iframeToken1" });
    },
  });
  assert.equal(payments.payments.get(merchantOid)?.amountMinor, amountMinor);
  assert.equal(payments.payments.get(merchantOid)?.type, "wallet_topup");

  await assert.rejects(
    () =>
      startWalletTopup({
        user: { uid: "user-a", email: "buyer@example.com" },
        packageId: "p500",
        customAmountMinor: 5_000,
        profile,
        userIp: "203.0.113.10",
        config,
        payments: new MemoryPaymentRepository(),
      }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_REQUEST",
  );

  const fields = {
    merchant_oid: merchantOid,
    status: "success",
    total_amount: "12550",
    payment_amount: "12550",
    hash: callbackHash("success", "12550"),
    currency: "TL",
  };
  const first = await handlePaytrCallback({ fields, config, payments });
  const second = await handlePaytrCallback({ fields, config, payments });
  assert.equal(first.event, "WALLET_TOPUP_SUCCEEDED");
  assert.equal(second.event, "WALLET_TOPUP_DUPLICATE");
  assert.equal(payments.balance("user-a"), amountMinor);
  assert.equal(payments.ledger.size, 1);
  assert.equal(payments.payments.get(merchantOid)?.status, "succeeded");
});

test("topup posts the package amount and the saved customer", async () => {
  const payments = new MemoryPaymentRepository();
  let posted = "";
  const result = await startWalletTopup({
    user: { uid: "user-a", email: "buyer@example.com" },
    packageId: "p500",
    profile,
    userIp: "203.0.113.10",
    config,
    payments,
    merchantOid,
    fetchImpl: async (_url, init) => {
      posted = String(init.body);
      return Response.json({ status: "success", token: "iframeToken1" });
    },
  });
  const params = new URLSearchParams(posted);
  const basket = buildUserBasket("Bakiye yükleme", 50_000);
  const expected = createPaytrToken({
    merchantId: config.merchantId,
    userIp: "203.0.113.10",
    merchantOid,
    email: "buyer@example.com",
    paymentAmount: "50000",
    userBasket: basket,
    noInstallment: "0",
    maxInstallment: "0",
    currency: "TL",
    testMode: "1",
    merchantSalt,
    merchantKey,
  });
  assert.equal(params.get("payment_amount"), "50000");
  assert.equal(params.get("paytr_token"), expected);
  assert.equal(params.get("user_name"), profile.fullName);
  assert.equal(params.get("user_phone"), profile.phone);
  assert.equal(params.get("user_address"), profile.address);
  assert.equal(posted.includes("05000000000"), false);
  assert.equal(posted.includes(merchantKey), false);
  assert.equal(posted.includes(merchantSalt), false);
  assert.equal(payments.payments.get(merchantOid)?.type, "wallet_topup");
  assert.equal(payments.payments.get(merchantOid)?.orderId, null);
  const client = { token: result.token, iframeUrl: result.iframeUrl };
  assert.deepEqual(Object.keys(client).sort(), ["iframeUrl", "token"]);
  assert.equal(JSON.stringify(client).includes("merchant"), false);
});

test("successful callback credits the wallet once", async () => {
  const payments = new MemoryPaymentRepository();
  await startWalletTopup({
    user: { uid: "user-a", email: "buyer@example.com" },
    packageId: "p500",
    profile,
    userIp: "203.0.113.10",
    config,
    payments,
    merchantOid,
    fetchImpl: async () => Response.json({ status: "success", token: "iframeToken1" }),
  });
  const fields = {
    merchant_oid: merchantOid,
    status: "success",
    total_amount: "50000",
    payment_amount: "50000",
    hash: callbackHash("success", "50000"),
    currency: "TL",
  };
  const first = await handlePaytrCallback({ fields, config, payments });
  const second = await handlePaytrCallback({ fields, config, payments });
  assert.equal(first.response, "OK");
  assert.equal(first.event, "WALLET_TOPUP_SUCCEEDED");
  assert.equal(second.event, "WALLET_TOPUP_DUPLICATE");
  assert.equal(payments.balance("user-a"), 50_000);
  assert.equal(payments.balance("user-b"), 0);
  assert.equal(payments.ledger.size, 1);
  assert.equal(payments.payments.get(merchantOid)?.status, "succeeded");
  const entry = [...payments.ledger.values()][0];
  assert.equal(entry?.type, "topup");
  assert.equal(entry?.id, `topup_${merchantOid}`);
  assert.equal(entry?.balanceBeforeMinor, 0);
  assert.equal(entry?.balanceAfterMinor, 50_000);
  const parsed = publicLedgerSchema.parse({
    id: entry?.id,
    type: entry?.type,
    amountMinor: entry?.amountMinor,
    currency: entry?.currency,
    description: entry?.description,
    createdAt: entry?.createdAt,
    orderId: entry?.orderId ?? null,
  });
  assert.equal("paymentId" in parsed, false);
  assert.equal("referenceId" in parsed, false);
  assert.equal("userId" in parsed, false);
});

test("parallel topup callbacks do not credit twice", async () => {
  const payments = new MemoryPaymentRepository();
  await startWalletTopup({
    user: { uid: "user-a", email: "buyer@example.com" },
    packageId: "p1000",
    profile,
    userIp: "203.0.113.10",
    config,
    payments,
    merchantOid,
    fetchImpl: async () => Response.json({ status: "success", token: "iframeToken1" }),
  });
  const fields = {
    merchant_oid: merchantOid,
    status: "success",
    total_amount: "100000",
    payment_amount: "100000",
    hash: callbackHash("success", "100000"),
    currency: "TL",
  };
  const results = await Promise.all([
    handlePaytrCallback({ fields, config, payments }),
    handlePaytrCallback({ fields, config, payments }),
  ]);
  assert.equal(results.filter((result) => result.event === "WALLET_TOPUP_SUCCEEDED").length, 1);
  assert.equal(payments.balance("user-a"), 100_000);
  assert.equal(payments.ledger.size, 1);
});

test("insufficient balance blocks the order and sufficient balance creates a paid order once", async () => {
  const empty = new MemoryCheckout();
  await assert.rejects(
    () => placeOrder({ userId: "user-a", body: body(), findService: async () => service(), orders: empty }),
    (error: unknown) =>
      error instanceof AppError &&
      error.status === 402 &&
      error.code === "INSUFFICIENT_BALANCE" &&
      error.publicMessage === "Yetersiz bakiye. Bakiye yükleyin.",
  );
  assert.equal(empty.size(), 0);
  assert.equal(empty.balance("user-a"), 0);
  assert.equal(empty.ledgerCount(), 0);

  const funded = new MemoryCheckout();
  funded.fund("user-a", 20_000);
  const created = await placeOrder({
    userId: "user-a",
    body: body(),
    findService: async () => service(),
    orders: funded,
  });
  const replay = await placeOrder({
    userId: "user-a",
    body: body(2000),
    findService: async () => service(),
    orders: funded,
  });
  assert.equal(created.created, true);
  assert.equal(created.order.status, "paid");
  assert.equal(created.order.salePriceMinor, 14_990);
  assert.equal(replay.created, false);
  assert.equal(replay.order.id, created.order.id);
  assert.equal(funded.size(), 1);
  assert.equal(funded.balance("user-a"), 20_000 - 14_990);
  assert.equal(funded.ledgerCount(), 1);
  assert.equal(funded.listTransactions("user-a", 1).transactions[0]?.type, "order_debit");
  assert.equal(funded.listTransactions("user-b", 1).transactions.length, 0);
  assert.deepEqual(Object.keys(funded.getPublicWallet("user-a")).sort(), ["balanceMinor", "currency"]);
});

test("duplicate order requests debit once even in parallel", async () => {
  const orders = new MemoryCheckout();
  orders.fund("user-a", 40_000);
  const [first, second] = await Promise.all([
    placeOrder({ userId: "user-a", body: body(), findService: async () => service(), orders }),
    placeOrder({ userId: "user-a", body: body(), findService: async () => service(), orders }),
  ]);
  assert.equal(first.order.id, second.order.id);
  assert.equal([first.created, second.created].filter(Boolean).length, 1);
  assert.equal(orders.balance("user-a"), 40_000 - 14_990);
  assert.equal(orders.ledgerCount(), 1);
  assert.equal(orders.size(), 1);
});

test("refund credits once and a second refund is idempotent", async () => {
  const orders = new MemoryCheckout();
  orders.fund("user-a", 20_000);
  const created = await placeOrder({
    userId: "user-a",
    body: body(),
    findService: async () => service(),
    orders,
  });
  const refunded = await orders.refundOrderToWallet(created.order.id, "Sağlayıcı başarısız");
  const again = await orders.refundOrderToWallet(created.order.id, "Sağlayıcı başarısız");
  assert.equal(refunded, "refunded");
  assert.equal(again, "duplicate");
  assert.equal(orders.balance("user-a"), 20_000);
  assert.equal((await orders.getForUser(created.order.id, "user-a"))?.status, "refunded");
  assert.equal(orders.listTransactions("user-a", 1).transactions.filter((entry) => entry.type === "refund").length, 1);

  const legacy = new MemoryCheckout();
  legacy.fund("user-a", 5000);
  legacy.seed({
    id: "b".repeat(64),
    userId: "user-a",
    serviceId: 42,
    serviceName: "Takipçi",
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
    status: "pending_payment",
    idempotencyKey: key,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  });
  assert.equal(await legacy.refundOrderToWallet("b".repeat(64), "Sağlayıcı başarısız"), "not_refundable");
  assert.equal(legacy.balance("user-a"), 5000);
});

test("wallet routes stay on the session user and hide provider secrets", () => {
  const walletRoute = readFileSync(join(root, "src/app/api/wallet/route.ts"), "utf8");
  const movementRoute = readFileSync(join(root, "src/app/api/wallet/transactions/route.ts"), "utf8");
  const topupRoute = readFileSync(join(root, "src/app/api/wallet/topup/paytr/init/route.ts"), "utf8");
  const iframe = readFileSync(join(root, "src/lib/payments/paytr/iframe.ts"), "utf8");
  const checkout = readFileSync(join(root, "src/lib/wallet/firestore-checkout.ts"), "utf8");
  const refund = readFileSync(join(root, "src/lib/wallet/firestore-read.ts"), "utf8");
  const ordersRoute = readFileSync(join(root, "src/app/api/orders/route.ts"), "utf8");
  assert.equal(walletRoute.includes("requireApiUser"), true);
  assert.equal(walletRoute.includes("searchParams"), false);
  assert.equal(movementRoute.includes("requireApiUser"), true);
  assert.equal(topupRoute.includes("amountMinor"), true);
  assert.equal(topupRoute.includes("packageId"), true);
  assert.equal(iframe.includes("05000000000"), false);
  assert.equal(iframe.includes('"Turkiye"'), false);
  assert.equal(checkout.includes("runTransaction"), true);
  assert.equal(checkout.includes('status: "paid"') || checkout.includes("applyOrderDebit"), true);
  assert.equal(refund.includes("export async function refundOrderToWallet"), true);
  assert.equal(refund.includes("runTransaction"), true);
  assert.equal(refund.includes("action=add"), false);
  assert.equal(ordersRoute.includes("placePaidOrder"), true);
  assert.equal(ordersRoute.includes("WALLET_INSUFFICIENT_BALANCE"), true);
  assert.equal(ordersRoute.includes("WALLET_ORDER_DEBIT"), true);
  assert.equal(readFileSync(join(root, "src/lib/payments/handle-callback.ts"), "utf8").includes("action=add"), false);
});
