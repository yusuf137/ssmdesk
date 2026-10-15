import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assignRoleSchema, pricingUpdateSchema } from "../src/lib/admin/schema";
import { canAccessAdmin, pricingRoleFor, roleFromStored } from "../src/lib/auth/roles";
import { placeOrder, type OrderServiceSnapshot } from "../src/lib/orders/place-order";
import { toPublicOrder, type PublicOrder } from "../src/lib/orders/public-order";
import { createOrderSchema } from "../src/lib/orders/schema";
import { resolveRolePrice, type RoleMultiplierConfig, type ServiceRoleOverride } from "../src/lib/pricing/role-price";
import { decideProviderFunds } from "../src/lib/provider/funds";
import { decimalToMinor, parseProviderRate, providerBalanceLevel } from "../src/lib/provider/money";
import { MemoryCheckout } from "../src/lib/wallet/memory-checkout";

const root = join(import.meta.dirname, "..");
const KEY = "22222222-2222-4222-8222-222222222222";

const global: RoleMultiplierConfig = {
  userMultiplier: 1.8,
  dealerMultiplier: 1.35,
  minimumProfitMinor: 0,
};

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function service(overrides: Partial<OrderServiceSnapshot> = {}): OrderServiceSnapshot {
  return {
    id: 7,
    name: "Takipçi",
    category: "Instagram",
    salePrice: 18,
    costPrice: 10,
    min: 100,
    max: 5000,
    pricingRole: "user",
    pricingMultiplier: 1.8,
    ...overrides,
  };
}

function override(partial: Partial<ServiceRoleOverride> = {}): ServiceRoleOverride {
  return {
    enabled: true,
    fixedSalePrice: null,
    userFixedRateMinor: null,
    dealerFixedRateMinor: null,
    userMultiplier: null,
    dealerMultiplier: null,
    ...partial,
  };
}

test("missing and invalid stored roles stay user and never become admin", () => {
  assert.equal(roleFromStored(undefined), "user");
  assert.equal(roleFromStored(null), "user");
  assert.equal(roleFromStored(""), "user");
  assert.equal(roleFromStored("owner"), "user");
  assert.equal(roleFromStored("dealer"), "dealer");
  assert.equal(roleFromStored("admin"), "admin");
});

test("provider rate strings parse and invalid rates do not become numbers", () => {
  assert.equal(parseProviderRate("0.1234"), 0.1234);
  assert.equal(parseProviderRate("1"), 1);
  assert.equal(parseProviderRate("12.50"), 12.5);
  assert.equal(parseProviderRate("nope"), null);
  assert.equal(parseProviderRate(""), null);
});

test("new accounts default to user and the client cannot write a role", () => {
  const store = source("src/lib/auth/user-store.ts");
  assert.match(store, /role: "user" satisfies UserRole/);
  assert.equal(store.includes("body.role"), false);
  assert.equal(store.includes("request.role"), false);
  const rules = source("firestore.rules");
  assert.match(rules, /allow create, update, delete: if false/);
  assert.match(rules, /match \/pricingConfig\/\{configId\}/);
  assert.match(rules, /match \/pricingOverrides\/\{serviceId\}/);
});

test("client role and multiplier fields are rejected", () => {
  const parsed = createOrderSchema.safeParse({
    serviceId: 7,
    targetUrl: "https://example.com/p/1",
    quantity: 1000,
    idempotencyKey: KEY,
    role: "dealer",
    multiplier: 1.35,
  });
  assert.equal(parsed.success, false);
  assert.equal(assignRoleSchema.safeParse({ role: "admin" }).success, false);
  assert.equal(assignRoleSchema.safeParse({ role: "dealer", userId: "other" }).success, false);
});

test("admin pages and APIs stay server-gated", () => {
  assert.equal(canAccessAdmin("user"), false);
  assert.equal(canAccessAdmin("dealer"), false);
  assert.equal(canAccessAdmin("admin"), true);
  const layout = source("src/app/admin/layout.tsx");
  assert.match(layout, /notFound\(\)/);
  assert.match(layout, /user\.role !== "admin"/);
  for (const file of [
    "src/app/api/admin/overview/route.ts",
    "src/app/api/admin/orders/route.ts",
    "src/app/api/admin/refills/route.ts",
    "src/app/api/admin/refills/[id]/sync/route.ts",
    "src/app/api/admin/cancellations/route.ts",
    "src/app/api/admin/cancellations/[id]/sync/route.ts",
    "src/app/api/admin/orders/[id]/retry/route.ts",
    "src/app/api/admin/users/route.ts",
    "src/app/api/admin/users/[uid]/role/route.ts",
    "src/app/api/admin/users/[uid]/wallet-adjust/route.ts",
    "src/app/api/admin/pricing/route.ts",
    "src/app/api/admin/provider/route.ts",
    "src/app/api/admin/audit/route.ts",
  ]) {
    assert.match(source(file), /requireAdmin\(/, file);
  }
  const session = source("src/lib/auth/session.ts");
  assert.match(session, /export async function getAuthenticatedRole/);
  assert.match(session, /export async function requireAdmin/);
  assert.match(session, /export async function requireDealerOrAdmin/);
});

test("user and dealer prices use their own multipliers", () => {
  const user = resolveRolePrice({
    role: "user",
    costPrice: 10,
    fallbackMultiplier: 1.5,
    global,
    service: null,
    category: null,
  });
  const dealer = resolveRolePrice({
    role: "dealer",
    costPrice: 10,
    fallbackMultiplier: 1.5,
    global,
    service: null,
    category: null,
  });
  assert.equal(user?.salePrice, 18);
  assert.equal(user?.multiplier, 1.8);
  assert.equal(dealer?.salePrice, 13.5);
  assert.equal(dealer?.multiplier, 1.35);
  assert.equal(pricingRoleFor("admin"), "user");
});

test("service fixed rate beats a role multiplier, then category, then global, then fallback", () => {
  const fixed = resolveRolePrice({
    role: "dealer",
    costPrice: 10,
    fallbackMultiplier: 1.5,
    global,
    service: override({ dealerFixedRateMinor: 1200, dealerMultiplier: 9 }),
    category: { userMultiplier: null, dealerMultiplier: 4 },
  });
  assert.equal(fixed?.salePrice, 12);

  const serviceMultiplier = resolveRolePrice({
    role: "user",
    costPrice: 10,
    fallbackMultiplier: 1.5,
    global,
    service: override({ userMultiplier: 2 }),
    category: { userMultiplier: 3, dealerMultiplier: null },
  });
  assert.equal(serviceMultiplier?.salePrice, 20);

  const category = resolveRolePrice({
    role: "dealer",
    costPrice: 10,
    fallbackMultiplier: 1.5,
    global,
    service: null,
    category: { userMultiplier: null, dealerMultiplier: 2 },
  });
  assert.equal(category?.multiplier, 2);

  const fallback = resolveRolePrice({
    role: "user",
    costPrice: 10,
    fallbackMultiplier: 1.5,
    global: { userMultiplier: 0, dealerMultiplier: 0, minimumProfitMinor: 0 },
    service: null,
    category: null,
  });
  assert.equal(fallback?.multiplier, 1.5);
});

test("pricing updates reject zero, negative, and out-of-range multipliers", () => {
  assert.equal(
    pricingUpdateSchema.safeParse({
      type: "global",
      userMultiplier: 0,
      dealerMultiplier: 1.35,
      minimumProfitMinor: 0,
    }).success,
    false,
  );
  assert.equal(
    pricingUpdateSchema.safeParse({
      type: "global",
      userMultiplier: -1,
      dealerMultiplier: 1.35,
      minimumProfitMinor: 0,
    }).success,
    false,
  );
  assert.equal(
    pricingUpdateSchema.safeParse({
      type: "global",
      userMultiplier: 11,
      dealerMultiplier: 1.35,
      minimumProfitMinor: 0,
    }).success,
    false,
  );
  assert.equal(
    pricingUpdateSchema.safeParse({
      type: "global",
      userMultiplier: 1.8,
      dealerMultiplier: 1.35,
      minimumProfitMinor: 0,
      role: "dealer",
    }).success,
    false,
  );
});

test("an order snapshots the server role price and hides provider cost", async () => {
  const checkout = new MemoryCheckout();
  checkout.fund("user-a", 100_000);
  const result = await placeOrder({
    userId: "user-a",
    body: {
      serviceId: 7,
      targetUrl: "https://example.com/p/1",
      quantity: 1000,
      idempotencyKey: KEY,
    },
    findService: async () => service({ pricingRole: "dealer", pricingMultiplier: 1.35, salePrice: 13.5 }),
    orders: { placePaidOrder: checkout.placePaidOrder.bind(checkout) },
  });
  const stored = await checkout.getForUser(result.order.id, "user-a");
  assert.equal(stored?.pricingRole, "dealer");
  assert.equal(stored?.pricingMultiplier, 1.35);
  assert.equal(result.order.salePriceMinor, 1350);
  const keys = Object.keys(result.order);
  assert.equal(keys.includes("pricingRole"), false);
  const publicOrder: PublicOrder = toPublicOrder(stored!);
  assert.equal("providerCostMinor" in publicOrder, false);
  assert.equal("costPrice" in publicOrder, false);
  assert.equal(checkout.readProviderCost(result.order.id) !== undefined, true);
});

test("low provider balance waits for funds and retry stays admin-only", () => {
  assert.equal(
    decideProviderFunds({ status: "paid", providerCostMinor: 800, providerBalanceMinor: 500 }),
    "awaiting_provider_funds",
  );
  assert.equal(
    decideProviderFunds({ status: "checking_provider_balance", providerCostMinor: 800, providerBalanceMinor: 800 }),
    "submitting",
  );
  assert.equal(providerBalanceLevel(1000, 50000), "critical");
  assert.equal(providerBalanceLevel(40000, 50000), "low");
  assert.equal(providerBalanceLevel(50000, 50000), "normal");
  assert.equal(decimalToMinor("100.84292"), 10084);
  assert.equal(decimalToMinor("100.845"), 10085);
  const review = source("src/lib/provider/review-funds.ts");
  assert.match(review, /retryAwaitingProviderOrder/);
  assert.equal(review.includes('action: "add"'), false);
  assert.equal(review.includes("action=add"), false);
  assert.match(source("src/app/api/admin/provider/route.ts"), /requireAdmin\(/);
  assert.match(source("src/app/api/services/route.ts"), /searchParams\.has\("role"\)/);
  assert.match(source("src/app/api/orders/route.ts"), /getOrderableService\(serviceId, user\.role\)/);
});
