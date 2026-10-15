import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ZodError } from "zod";

import { RATE_LIMITS } from "../src/lib/constants";
import { AppError, RateLimitError } from "../src/lib/http/errors";
import { enforceRateLimit, MemoryRateLimitStore } from "../src/lib/http/rate-limit";
import { orderDocumentId } from "../src/lib/orders/id";
import { formatMinor } from "../src/lib/orders/money";
import { calculateOrderPrice } from "../src/lib/pricing/calculate-order-price";
import { MemoryCheckout } from "../src/lib/wallet/memory-checkout";
import { placeOrder, type OrderServiceSnapshot } from "../src/lib/orders/place-order";
import { publicOrderSchema, toPublicOrder } from "../src/lib/orders/public-order";
import { readOwnOrder } from "../src/lib/orders/read-order";
import { orderDocument, type OrderRecord } from "../src/lib/orders/repository";
import { createOrderSchema, isPublicHttpUrl } from "../src/lib/orders/schema";

const root = join(import.meta.dirname, "..");
const KEY = "11111111-1111-4111-8111-111111111111";

function fundedCheckout(): MemoryCheckout {
  const orders = new MemoryCheckout();
  orders.fund("user-a", 50_000_000);
  orders.fund("user-b", 50_000_000);
  return orders;
}

function service(overrides: Partial<OrderServiceSnapshot> = {}): OrderServiceSnapshot {
  return {
    id: 42,
    name: "Takipçi",
    category: "Instagram",
    salePrice: 149.9,
    costPrice: 10,
    min: 100,
    max: 10_000,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: 42,
    targetUrl: "https://example.com/post/1",
    quantity: 1000,
    idempotencyKey: KEY,
    ...overrides,
  };
}

test("price per thousand converts to minor units", () => {
  assert.equal(calculateOrderPrice(1000, 149.9), 14990);
  assert.equal(formatMinor(14990), "149.90");
  assert.equal(calculateOrderPrice(500, 10), 500);
  assert.equal(calculateOrderPrice(1, 0.01), null);
});

test("only http and https targets are accepted", () => {
  assert.equal(isPublicHttpUrl("https://example.com/a"), true);
  assert.equal(isPublicHttpUrl("http://example.com/a"), true);
  assert.equal(isPublicHttpUrl("javascript:alert(1)"), false);
  assert.equal(isPublicHttpUrl("file:///etc/passwd"), false);
  assert.equal(isPublicHttpUrl("data:text/html,hi"), false);
  assert.equal(isPublicHttpUrl("ftp://example.com/a"), false);
  assert.equal(isPublicHttpUrl("https://user:pass@example.com/a"), false);
  assert.equal(createOrderSchema.safeParse(body({ targetUrl: "javascript:alert(1)" })).success, false);
});

test("unauthenticated order is rejected", async () => {
  const orders = fundedCheckout();
  await assert.rejects(
    () => placeOrder({ userId: null, body: body(), findService: async () => service(), orders }),
    (error: unknown) => error instanceof AppError && error.code === "UNAUTHENTICATED" && error.status === 401,
  );
  assert.equal(orders.size(), 0);
});

test("unknown order fields are rejected", async () => {
  const orders = fundedCheckout();
  await assert.rejects(
    () =>
      placeOrder({
        userId: "user-a",
        body: body({
          userId: "other-user",
          price: 1,
          salePrice: 1,
          providerCost: 1,
          status: "paid",
          providerOrderId: "9",
          role: "admin",
        }),
        findService: async () => service(),
        orders,
      }),
    (error: unknown) => error instanceof ZodError,
  );
  assert.equal(orders.size(), 0);
});

test("invalid service, quantity bounds, and client price cannot create an order", async () => {
  const orders = fundedCheckout();
  const findService = async (serviceId: number) => (serviceId === 42 ? service() : null);

  await assert.rejects(
    () => placeOrder({ userId: "user-a", body: body({ serviceId: 7 }), findService, orders }),
    (error: unknown) => error instanceof AppError && error.code === "SERVICE_UNAVAILABLE",
  );
  await assert.rejects(
    () => placeOrder({ userId: "user-a", body: body({ quantity: 50 }), findService, orders }),
    (error: unknown) => error instanceof AppError && error.code === "QUANTITY_TOO_LOW",
  );
  await assert.rejects(
    () => placeOrder({ userId: "user-a", body: body({ quantity: 10_001 }), findService, orders }),
    (error: unknown) => error instanceof AppError && error.code === "QUANTITY_TOO_HIGH",
  );
  await assert.rejects(
    () => placeOrder({ userId: "user-a", body: body({ salePrice: 0.01, price: 1 }), findService, orders }),
    (error: unknown) => error instanceof ZodError,
  );
  assert.equal(orders.size(), 0);
});

test("same idempotency key does not create a second order", async () => {
  const orders = fundedCheckout();
  const findService = async () => service();
  const created = await placeOrder({ userId: "user-a", body: body(), findService, orders });
  const replay = await placeOrder({
    userId: "user-a",
    body: body({ quantity: 2000 }),
    findService,
    orders,
  });

  const racedOrders = fundedCheckout();
  const [raced, racedAgain] = await Promise.all([
    placeOrder({ userId: "user-a", body: body(), findService, orders: racedOrders }),
    placeOrder({ userId: "user-a", body: body(), findService, orders: racedOrders }),
  ]);

  assert.equal(orders.size(), 1);
  assert.equal(created.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.order.id, created.order.id);
  assert.equal(replay.order.quantity, 1000);
  assert.equal(replay.order.salePriceMinor, 14990);
  assert.equal(orders.readProviderCost(created.order.id), calculateOrderPrice(1000, 10));
  assert.equal(racedOrders.size(), 1);
  assert.equal(raced.order.id, racedAgain.order.id);
  assert.equal([raced.created, racedAgain.created].filter(Boolean).length, 1);
});

test("different users can reuse an idempotency key and cannot read each other", async () => {
  const orders = fundedCheckout();
  const findService = async () => service();
  const first = await placeOrder({
    userId: "user-a",
    body: body(),
    findService,
    orders,
  });
  const second = await placeOrder({
    userId: "user-b",
    body: body(),
    findService,
    orders,
  });

  assert.equal(orders.size(), 2);
  assert.notEqual(first.order.id, second.order.id);
  assert.notEqual(orderDocumentId("user-a", KEY), orderDocumentId("user-b", KEY));
  assert.equal(await orders.getForUser(first.order.id, "user-b"), null);
  await assert.rejects(
    () => readOwnOrder(orders, first.order.id, "user-b"),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
  const own = await readOwnOrder(orders, first.order.id, "user-a");
  assert.equal(own.id, first.order.id);
  assert.equal((await orders.accessForUser(first.order.id, "user-b")).kind, "foreign");
  assert.equal((await orders.accessForUser(first.order.id, "user-a")).kind, "own");
});

test("public order dto omits internal cost fields", async () => {
  const orders = fundedCheckout();
  const result = await placeOrder({
    userId: "user-a",
    body: body(),
    findService: async () => service(),
    orders,
  });
  const keys = Object.keys(result.order).sort();
  assert.deepEqual(keys, [
    "category",
    "createdAt",
    "currency",
    "id",
    "quantity",
    "salePriceMinor",
    "serviceId",
    "serviceName",
    "status",
    "targetUrl",
  ]);
  const serialized = JSON.stringify(result.order);
  assert.equal(serialized.includes("providerCost"), false);
  assert.equal(serialized.includes("providerOrderId"), false);
  assert.equal(serialized.includes("costPrice"), false);
  assert.equal(serialized.includes("idempotencyKey"), false);
  assert.equal(serialized.includes("userId"), false);
  assert.equal(result.order.salePriceMinor, 14990);
  assert.equal(result.order.category, "Instagram");

  const withCost = publicOrderSchema.safeParse({ ...result.order, providerCostMinor: 100, providerCost: 1 });
  assert.equal(withCost.success, false);

  const record = await orders.getForUser(result.order.id, "user-a");
  assert.ok(record);
  const documentKeys = Object.keys(orderDocument(record)).sort();
  assert.equal(documentKeys.includes("providerCostMinor"), false);
  assert.equal(documentKeys.includes("providerCost"), false);
  const parsed = publicOrderSchema.safeParse(toPublicOrder(record));
  assert.equal(parsed.success, true);
});

test("order routes do not submit to the provider", () => {
  const files = [
    "src/app/api/orders/route.ts",
    "src/app/api/orders/[id]/route.ts",
    "src/lib/orders/place-order.ts",
    "src/lib/orders/firestore-repository.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    assert.equal(source.includes("createOrder("), false, file);
    assert.equal(source.includes(".createOrder"), false, file);
    assert.equal(source.includes("action=add"), false, file);
    assert.equal(source.includes('action: "add"'), false, file);
    assert.equal(source.includes("SMMFULL_API_KEY"), false, file);
  }

  const createRoute = readFileSync(join(root, "src/app/api/orders/route.ts"), "utf8");
  assert.equal(createRoute.includes("requireApiUser"), true);
  assert.equal(createRoute.includes("body.userId"), false);
  assert.equal(createRoute.includes('searchParams.has("userId")') || createRoute.includes("readOrderListQuery"), true);
  assert.equal(createRoute.includes("critical: true"), true);
  assert.equal(readFileSync(join(root, "src/lib/http/errors.ts"), "utf8").includes("TOO_MANY_REQUESTS"), true);

  const rules = readFileSync(join(root, "firestore.rules"), "utf8");
  const ordersRule = rules.slice(rules.indexOf("match /orders/"), rules.indexOf("match /orderPrivate/"));
  assert.match(ordersRule, /allow read, write: if false/);
  const appSource = readFileSync(join(root, "src/app/api/orders/route.ts"), "utf8");
  assert.equal(appSource.includes("firebase/firestore"), false);
});

test("stored order keeps provider submission empty", async () => {
  const orders = fundedCheckout();
  const result = await placeOrder({
    userId: "user-a",
    body: body(),
    findService: async () => service({ salePrice: 10, costPrice: 4 }),
    orders,
  });
  const record: OrderRecord | null = await orders.getForUser(result.order.id, "user-a");
  assert.ok(record);
  assert.equal(record.status, "paid");
  assert.equal(record.provider, "smmfull");
  assert.equal(record.providerOrderId, null);
  assert.equal(record.providerStatus, null);
  assert.equal(record.currency, "TRY");
  assert.equal(result.order.salePriceMinor, 1000);
  assert.equal(result.order.status, "paid");
  assert.equal("providerOrderId" in result.order, false);
});

test("string service ids are accepted and client userId is not", async () => {
  const orders = fundedCheckout();
  const created = await placeOrder({
    userId: "user-a",
    body: body({ serviceId: "42" }),
    findService: async () => service(),
    orders,
  });
  assert.equal(created.order.serviceId, 42);
  assert.equal(createOrderSchema.safeParse(body({ userId: "user-a" })).success, false);
});

test("order creation rate limit returns 429", async () => {
  assert.ok(RATE_LIMITS.ordersUser.limit < RATE_LIMITS.servicesUser.limit);
  const store = new MemoryRateLimitStore();
  const subject = { route: "orders-create", kind: "user" as const, value: `user-${process.hrtime.bigint().toString()}` };
  const options = { scope: "orders_user", critical: true, store, fallback: null };
  for (let attempt = 0; attempt < RATE_LIMITS.ordersUser.limit; attempt += 1) {
    await enforceRateLimit(subject, RATE_LIMITS.ordersUser, options);
  }
  await assert.rejects(
    () => enforceRateLimit(subject, RATE_LIMITS.ordersUser, options),
    (error: unknown) =>
      error instanceof RateLimitError &&
      error.status === 429 &&
      error.code === "TOO_MANY_REQUESTS" &&
      (error.retryAfterSeconds ?? 0) >= 1,
  );
});
