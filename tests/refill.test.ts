import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { canAccessAdmin } from "../src/lib/auth/roles";
import { PROVIDER_CALL_POLICY } from "../src/lib/constants";
import { AppError } from "../src/lib/http/errors";
import { publicOrderResponseSchema } from "../src/lib/orders/public-order";
import {
  decideRefillEligibility,
  decideRefillSync,
  isActiveRefillStatus,
  mapProviderRefillStatus,
  refillRequestSchema,
  runRefillRequest,
  toPublicRefill,
  type RefillClaim,
  type RefillRecord,
} from "../src/lib/refill/policy";

const root = join(import.meta.dirname, "..");
const orderId = "ab".repeat(32);
const refillId = "cd".repeat(32);
const now = "2026-10-15T12:00:00.000Z";
const nowMs = Date.parse(now);
const day = 24 * 60 * 60 * 1000;

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function refill(overrides: Partial<RefillRecord> = {}): RefillRecord {
  return {
    id: refillId,
    userId: "user-a",
    orderId,
    provider: "smmfull",
    providerOrderId: "100",
    providerRefillId: null,
    status: "submitting",
    requestedAt: now,
    submittedAt: null,
    completedAt: null,
    rejectedAt: null,
    lastCheckedAt: null,
    providerStatus: null,
    internalErrorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function eligible(overrides: Partial<Parameters<typeof decideRefillEligibility>[0]> = {}) {
  return decideRefillEligibility({
    owner: true,
    providerOrderId: "100",
    refillSupported: true,
    orderStatus: "completed",
    activeStatus: null,
    lastTerminalAt: null,
    nowMs,
    cooldownMs: day,
    ...overrides,
  });
}

test("only the order owner can request a refill", () => {
  assert.equal(eligible({ owner: false }).ok, false);
  if (!eligible({ owner: false }).ok) {
    assert.equal(eligible({ owner: false }).ok === false && !eligible({ owner: false }).ok, true);
  }
  const denied = decideRefillEligibility({
    owner: false,
    providerOrderId: "100",
    refillSupported: true,
    orderStatus: "completed",
    activeStatus: null,
    lastTerminalAt: null,
    nowMs,
    cooldownMs: day,
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "not_owner");
  const route = source("src/app/api/orders/[id]/refill/route.ts");
  assert.match(route, /requireApiUser\(/);
  assert.match(route, /access\.kind === "foreign"/);
  assert.match(route, /ORDER_UNAUTHORIZED_ACCESS/);
  assert.equal(canAccessAdmin("user"), false);
  assert.equal(canAccessAdmin("dealer"), false);
  assert.equal(canAccessAdmin("admin"), true);
});

test("refill is rejected without support or a provider order", () => {
  const unsupported = eligible({ refillSupported: false });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.code, "refill_not_supported");
  const missing = eligible({ providerOrderId: null });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "missing_provider_order");
  for (const status of ["cancelled", "refunded", "failed", "pending_payment", "paid"] as const) {
    const blocked = eligible({ orderStatus: status });
    assert.equal(blocked.ok, false, status);
  }
  assert.equal(eligible({ orderStatus: "in_progress" }).ok, true);
  assert.equal(eligible({ orderStatus: "partial" }).ok, true);
});

test("an active refill blocks a second request and cooldown applies after a terminal result", () => {
  const active = eligible({ activeStatus: "processing" });
  assert.equal(active.ok, false);
  if (!active.ok) assert.equal(active.code, "active_refill_exists");
  assert.equal(isActiveRefillStatus("unknown"), true);
  assert.equal(isActiveRefillStatus("completed"), false);
  const cooling = eligible({ lastTerminalAt: new Date(nowMs - 60 * 60 * 1000).toISOString() });
  assert.equal(cooling.ok, false);
  if (!cooling.ok) assert.equal(cooling.code, "cooldown");
  const ready = eligible({ lastTerminalAt: new Date(nowMs - 25 * 60 * 60 * 1000).toISOString() });
  assert.equal(ready.ok, true);
});

test("concurrent refill claims make one provider call", async () => {
  let tail = Promise.resolve();
  let active: RefillRecord | null = null;
  let calls = 0;

  async function claim(): Promise<RefillClaim> {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = tail;
    tail = previous.then(() => gate);
    await previous;
    try {
      if (active && isActiveRefillStatus(active.status)) return { kind: "duplicate", refill: active };
      active = refill();
      return { kind: "claimed", refill: active, providerOrderId: "100" };
    } finally {
      release();
    }
  }

  const ports = {
    claim,
    now,
    onEvent() {},
    async requestRefill() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { providerRefillId: "55" };
    },
    async markProcessing(id: string, providerRefillId: string) {
      const next = refill({ id, status: "processing", providerRefillId });
      active = next;
      return next;
    },
    async markRejected() {
      throw new Error("unexpected reject");
    },
    async markUnknown() {
      throw new Error("unexpected unknown");
    },
  };

  const [first, second] = await Promise.all([runRefillRequest(ports), runRefillRequest(ports)]);
  assert.equal(calls, 1);
  assert.equal([first.kind, second.kind].filter((kind) => kind === "processing").length, 1);
  assert.equal([first.kind, second.kind].includes("duplicate"), true);
});

test("provider success, reject, and timeout stay single-shot", async () => {
  let calls = 0;
  let current = refill();
  const success = await runRefillRequest({
    now,
    onEvent() {},
    async claim() {
      return { kind: "claimed", refill: current, providerOrderId: "100" };
    },
    async requestRefill() {
      calls += 1;
      return { providerRefillId: "77" };
    },
    async markProcessing(_id, providerRefillId) {
      current = refill({ status: "processing", providerRefillId });
      return current;
    },
    async markRejected() {
      throw new Error("unexpected");
    },
    async markUnknown() {
      throw new Error("unexpected");
    },
  });
  assert.equal(success.kind, "processing");
  if (success.kind === "processing") assert.equal(success.refill.providerRefillId, "77");

  calls = 0;
  const rejected = await runRefillRequest({
    now,
    onEvent() {},
    async claim() {
      return { kind: "claimed", refill: refill(), providerOrderId: "100" };
    },
    async requestRefill() {
      calls += 1;
      throw new AppError("PROVIDER_REJECTED", 502, "Refill talebi sağlayıcı tarafından reddedildi.", "provider_error:refill period expired");
    },
    async markProcessing() {
      throw new Error("unexpected");
    },
    async markRejected(_id, code) {
      return refill({ status: "rejected", internalErrorCode: code, rejectedAt: now });
    },
    async markUnknown() {
      throw new Error("unexpected");
    },
  });
  assert.equal(calls, 1);
  assert.equal(rejected.kind, "rejected");
  if (rejected.kind === "rejected") assert.equal(rejected.refill.internalErrorCode, "refill_period_expired");

  calls = 0;
  let stored: RefillRecord | null = null;
  const unknown = await runRefillRequest({
    now,
    onEvent() {},
    async claim() {
      if (stored && isActiveRefillStatus(stored.status)) return { kind: "duplicate", refill: stored };
      stored = refill({ status: "submitting" });
      return { kind: "claimed", refill: stored, providerOrderId: "100" };
    },
    async requestRefill() {
      calls += 1;
      throw new Error("timeout");
    },
    async markProcessing() {
      throw new Error("unexpected");
    },
    async markRejected() {
      throw new Error("unexpected");
    },
    async markUnknown(_id, code) {
      stored = refill({ status: "unknown", internalErrorCode: code });
      return stored;
    },
  });
  const repeat = await runRefillRequest({
    now,
    onEvent() {},
    async claim() {
      if (stored && isActiveRefillStatus(stored.status)) return { kind: "duplicate", refill: stored };
      stored = refill({ status: "submitting" });
      return { kind: "claimed", refill: stored, providerOrderId: "100" };
    },
    async requestRefill() {
      calls += 1;
      throw new Error("timeout");
    },
    async markProcessing() {
      throw new Error("unexpected");
    },
    async markRejected() {
      throw new Error("unexpected");
    },
    async markUnknown() {
      throw new Error("unexpected");
    },
  });
  assert.equal(unknown.kind, "unknown");
  assert.equal(repeat.kind, "duplicate");
  assert.equal(calls, 1);
});

test("provider refill status maps without exposing internal fields", () => {
  assert.equal(mapProviderRefillStatus("Pending"), "processing");
  assert.equal(mapProviderRefillStatus("In progress"), "processing");
  assert.equal(mapProviderRefillStatus("Completed"), "completed");
  assert.equal(mapProviderRefillStatus("Rejected"), "rejected");
  assert.equal(mapProviderRefillStatus("Canceled"), "rejected");
  assert.equal(mapProviderRefillStatus("mystery"), "unknown");
  assert.equal(decideRefillSync({ status: "processing", providerRefillId: null, lastCheckedAt: null, nowMs, force: true }), "skip");
  assert.equal(
    decideRefillSync({ status: "processing", providerRefillId: "9", lastCheckedAt: now, nowMs: nowMs + 10_000, force: false }),
    "skip",
  );
  assert.equal(
    decideRefillSync({ status: "processing", providerRefillId: "9", lastCheckedAt: now, nowMs: nowMs + 61_000, force: false }),
    "check",
  );
  assert.equal(decideRefillSync({ status: "completed", providerRefillId: "9", lastCheckedAt: null, nowMs, force: true }), "skip");

  const parsed = toPublicRefill(refill({ status: "processing", providerRefillId: "77", internalErrorCode: "not_eligible" }));
  assert.deepEqual(Object.keys(parsed).sort(), ["completedAt", "id", "orderId", "rejectedAt", "requestedAt", "status"]);
  const serialized = JSON.stringify(parsed);
  assert.equal(serialized.includes("providerRefillId"), false);
  assert.equal(serialized.includes("providerOrderId"), false);
  assert.equal(serialized.includes("internalErrorCode"), false);
  assert.equal(serialized.includes("userId"), false);
});

test("refill routes stay authenticated and the client cannot write refill fields", () => {
  assert.equal(refillRequestSchema.safeParse({}).success, true);
  assert.equal(refillRequestSchema.safeParse({ userId: "user-a" }).success, false);
  assert.equal(refillRequestSchema.safeParse({ providerOrderId: "100" }).success, false);
  assert.equal(refillRequestSchema.safeParse({ status: "completed" }).success, false);
  assert.equal(PROVIDER_CALL_POLICY.refill.retry, false);
  assert.equal(PROVIDER_CALL_POLICY.refillStatus.retry, false);
  const wrapper = source("src/lib/smmfull.ts");
  assert.match(wrapper, /action: "refill"/);
  assert.match(wrapper, /action: "refill_status"/);
  const adminList = source("src/app/api/admin/refills/route.ts");
  const adminSync = source("src/app/api/admin/refills/[id]/sync/route.ts");
  assert.match(adminList, /requireAdmin\(/);
  assert.match(adminSync, /requireAdmin\(/);
  assert.equal(adminSync.includes("requestRefill"), false);
  const firestore = source("src/lib/refill/firestore.ts");
  const sync = firestore.slice(firestore.indexOf("export async function syncRefillStatus"), firestore.indexOf("export async function listAdminRefills"));
  assert.equal(sync.includes("requestRefill"), false);
  assert.match(firestore, /getServices\(/);
  const rules = source("firestore.rules");
  const refillRule = rules.slice(rules.indexOf("match /refillRequests/"), rules.indexOf("match /refillSlots/"));
  const slotRule = rules.slice(rules.indexOf("match /refillSlots/"), rules.indexOf("match /{document=**}"));
  assert.match(refillRule, /allow read, write: if false/);
  assert.match(slotRule, /allow read, write: if false/);
  const order = {
    id: orderId,
    serviceId: 1,
    serviceName: "Takipçi",
    category: "Instagram",
    targetUrl: "https://example.com/p",
    quantity: 100,
    salePriceMinor: 1000,
    currency: "TRY" as const,
    status: "completed" as const,
    createdAt: now,
  };
  assert.equal(publicOrderResponseSchema.safeParse({ order }).success, true);
  const leaked = publicOrderResponseSchema.safeParse({
    order,
    refill: { canRequest: true, history: [], providerOrderId: "100" },
  });
  assert.equal(leaked.success, false);
});
