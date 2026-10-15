import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { canAccessAdmin } from "../src/lib/auth/roles";
import {
  cancelRequestSchema,
  decideCancelEligibility,
  decideCancelSettlement,
  interpretCancelPayload,
  isActiveCancelStatus,
  runCancelRequest,
  toPublicCancel,
  type CancelClaim,
  type CancelRecord,
} from "../src/lib/cancel/policy";
import { PROVIDER_CALL_POLICY } from "../src/lib/constants";
import { AppError } from "../src/lib/http/errors";
import type { OrderRecord } from "../src/lib/orders/repository";
import { applyAmountRefund } from "../src/lib/wallet/apply";
import type { LedgerEntry, WalletRecord } from "../src/lib/wallet/types";

const root = join(import.meta.dirname, "..");
const orderId = "ab".repeat(32);
const cancelId = "cd".repeat(32);
const now = "2026-10-15T12:00:00.000Z";

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function cancel(overrides: Partial<CancelRecord> = {}): CancelRecord {
  return {
    id: cancelId,
    userId: "user-a",
    orderId,
    provider: "smmfull",
    providerOrderId: "100",
    status: "submitting",
    previousOrderStatus: "in_progress",
    requestedAt: now,
    submittedAt: null,
    completedAt: null,
    rejectedAt: null,
    lastCheckedAt: null,
    internalErrorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function order(status: OrderRecord["status"] = "cancel_pending_settlement"): OrderRecord {
  return {
    id: orderId,
    userId: "user-a",
    serviceId: 1,
    serviceName: "Takipçi",
    category: "Instagram",
    targetUrl: "https://example.com/p",
    quantity: 100,
    currency: "TRY",
    salePriceMinor: 10_000,
    pricingRole: "user",
    pricingMultiplier: null,
    provider: "smmfull",
    providerOrderId: null,
    providerStatus: null,
    status,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    createdAt: now,
    updatedAt: now,
  };
}

function debit(): LedgerEntry {
  return {
    id: `debit_${orderId}`,
    userId: "user-a",
    type: "order_debit",
    amountMinor: 10_000,
    currency: "TRY",
    balanceBeforeMinor: 10_000,
    balanceAfterMinor: 0,
    paymentId: null,
    orderId,
    referenceId: orderId,
    description: "Sipariş",
    createdAt: now,
  };
}

function wallet(balanceMinor: number): WalletRecord {
  return { userId: "user-a", balanceMinor, currency: "TRY", createdAt: now, updatedAt: now };
}

test("only an eligible owned order can be cancelled", () => {
  assert.equal(
    decideCancelEligibility({
      owner: true,
      providerOrderId: "100",
      cancelSupported: true,
      orderStatus: "in_progress",
      activeStatus: null,
    }).ok,
    true,
  );
  const foreign = decideCancelEligibility({
    owner: false,
    providerOrderId: "100",
    cancelSupported: true,
    orderStatus: "in_progress",
    activeStatus: null,
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, "not_owner");
  const unsupported = decideCancelEligibility({
    owner: true,
    providerOrderId: "100",
    cancelSupported: false,
    orderStatus: "partial",
    activeStatus: null,
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.code, "cancel_not_supported");
  const missing = decideCancelEligibility({
    owner: true,
    providerOrderId: null,
    cancelSupported: true,
    orderStatus: "in_progress",
    activeStatus: null,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "missing_provider_order");
  for (const status of ["completed", "refunded", "cancelled"] as const) {
    const blocked = decideCancelEligibility({
      owner: true,
      providerOrderId: "100",
      cancelSupported: true,
      orderStatus: status,
      activeStatus: null,
    });
    assert.equal(blocked.ok, false, status);
  }
  const active = decideCancelEligibility({
    owner: true,
    providerOrderId: "100",
    cancelSupported: true,
    orderStatus: "in_progress",
    activeStatus: "unknown",
  });
  assert.equal(active.ok, false);
  if (!active.ok) assert.equal(active.code, "active_cancel_exists");
  const route = source("src/app/api/orders/[id]/cancel/route.ts");
  assert.match(route, /requireApiUser\(/);
  assert.match(route, /access\.kind === "foreign"/);
  assert.equal(canAccessAdmin("user"), false);
  assert.equal(canAccessAdmin("dealer"), false);
  assert.equal(canAccessAdmin("admin"), true);
});

test("concurrent cancel claims make one provider call", async () => {
  let tail = Promise.resolve();
  let active: CancelRecord | null = null;
  let calls = 0;
  async function claim(): Promise<CancelClaim> {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = tail;
    tail = previous.then(() => gate);
    await previous;
    try {
      if (active && isActiveCancelStatus(active.status)) return { kind: "duplicate", cancel: active };
      active = cancel();
      return { kind: "claimed", cancel: active, providerOrderId: "100" };
    } finally {
      release();
    }
  }
  const [first, second] = await Promise.all([
    runCancelRequest({
      now,
      claim,
      onEvent() {},
      async requestCancel() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { accepted: true };
      },
      async markAccepted(id) {
        const next = cancel({ id, status: "accepted" });
        active = next;
        return next;
      },
      async markRejected() {
        throw new Error("unexpected");
      },
      async markUnknown() {
        throw new Error("unexpected");
      },
    }),
    runCancelRequest({
      now,
      claim,
      onEvent() {},
      async requestCancel() {
        calls += 1;
        return { accepted: true };
      },
      async markAccepted(id) {
        const next = cancel({ id, status: "accepted" });
        active = next;
        return next;
      },
      async markRejected() {
        throw new Error("unexpected");
      },
      async markUnknown() {
        throw new Error("unexpected");
      },
    }),
  ]);
  assert.equal(calls, 1);
  assert.equal([first.kind, second.kind].includes("accepted"), true);
  assert.equal([first.kind, second.kind].includes("duplicate"), true);
});

test("provider accept does not refund, reject and timeout do not retry", async () => {
  let calls = 0;
  const accepted = await runCancelRequest({
    now,
    onEvent() {},
    async claim() {
      return { kind: "claimed", cancel: cancel(), providerOrderId: "100" };
    },
    async requestCancel() {
      calls += 1;
      return { accepted: true };
    },
    async markAccepted() {
      return cancel({ status: "accepted" });
    },
    async markRejected() {
      throw new Error("unexpected");
    },
    async markUnknown() {
      throw new Error("unexpected");
    },
  });
  assert.equal(accepted.kind, "accepted");
  assert.equal(calls, 1);
  assert.equal(
    decideCancelSettlement({ salePriceMinor: 10_000, quantity: 100, remains: 100, providerStatus: "In progress" }).kind,
    "wait",
  );

  calls = 0;
  const rejected = await runCancelRequest({
    now,
    onEvent() {},
    async claim() {
      return { kind: "claimed", cancel: cancel(), providerOrderId: "100" };
    },
    async requestCancel() {
      calls += 1;
      throw new AppError("PROVIDER_REJECTED", 502, "İptal talebi sağlayıcı tarafından reddedildi.", "cancel is not available");
    },
    async markAccepted() {
      throw new Error("unexpected");
    },
    async markRejected(_id, code) {
      return cancel({ status: "rejected", internalErrorCode: code, rejectedAt: now });
    },
    async markUnknown() {
      throw new Error("unexpected");
    },
  });
  assert.equal(rejected.kind, "rejected");
  if (rejected.kind === "rejected") assert.equal(rejected.cancel.internalErrorCode, "cancel_not_supported");

  calls = 0;
  let stored: CancelRecord | null = null;
  const unknown = await runCancelRequest({
    now,
    onEvent() {},
    async claim() {
      if (stored && isActiveCancelStatus(stored.status)) return { kind: "duplicate", cancel: stored };
      stored = cancel({ status: "submitting" });
      return { kind: "claimed", cancel: stored, providerOrderId: "100" };
    },
    async requestCancel() {
      calls += 1;
      throw new Error("timeout");
    },
    async markAccepted() {
      throw new Error("unexpected");
    },
    async markRejected() {
      throw new Error("unexpected");
    },
    async markUnknown() {
      stored = cancel({ status: "unknown", internalErrorCode: "provider_unavailable" });
      return stored;
    },
  });
  const repeat = await runCancelRequest({
    now,
    onEvent() {},
    async claim() {
      if (stored && isActiveCancelStatus(stored.status)) return { kind: "duplicate", cancel: stored };
      return { kind: "claimed", cancel: cancel(), providerOrderId: "100" };
    },
    async requestCancel() {
      calls += 1;
      return { accepted: true };
    },
    async markAccepted() {
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

test("settlement refunds the unused quantity once and keeps provider fields private", () => {
  const full = decideCancelSettlement({ salePriceMinor: 10_000, quantity: 100, remains: 100, providerStatus: "Canceled" });
  assert.equal(full.kind, "refund");
  if (full.kind === "refund") {
    assert.equal(full.amountMinor, 10_000);
    assert.equal(full.orderStatus, "refunded");
  }
  const partial = decideCancelSettlement({ salePriceMinor: 10_000, quantity: 100, remains: 40, providerStatus: "Partial" });
  assert.equal(partial.kind, "refund");
  if (partial.kind === "refund") {
    assert.equal(partial.amountMinor, 4_000);
    assert.equal(partial.orderStatus, "cancelled");
  }
  assert.equal(decideCancelSettlement({ salePriceMinor: 10_000, quantity: 100, remains: null, providerStatus: "Canceled" }).kind, "wait");
  assert.equal(decideCancelSettlement({ salePriceMinor: 10_000, quantity: 100, remains: 0, providerStatus: "Completed" }).kind, "close");

  const first = applyAmountRefund({
    order: order(),
    debit: debit(),
    existing: null,
    wallet: wallet(0),
    amountMinor: 4_000,
    referenceId: cancelId,
    ledgerId: `cxrefund_${"a".repeat(40)}`,
    nextStatus: "cancelled",
    now,
  });
  assert.equal(first.kind, "refunded");
  if (first.kind !== "refunded") return;
  assert.equal(first.wallet.balanceMinor, 4_000);
  assert.equal(first.ledger.type, "refund");
  assert.equal(first.ledger.referenceId, cancelId);
  const second = applyAmountRefund({
    order: first.order,
    debit: debit(),
    existing: first.ledger,
    wallet: first.wallet,
    amountMinor: 4_000,
    referenceId: cancelId,
    ledgerId: first.ledger.id,
    nextStatus: "cancelled",
    now,
  });
  assert.equal(second.kind, "duplicate");
  assert.equal(first.wallet.balanceMinor, 4_000);

  assert.equal(interpretCancelPayload([{ order: 2, cancel: 1 }], "2").outcome, "accepted");
  const rejected = interpretCancelPayload([{ order: 9, cancel: { error: "Incorrect order ID" } }], "9");
  assert.equal(rejected.outcome, "rejected");
  assert.equal(interpretCancelPayload({ unexpected: true }, "2").outcome, "unknown");

  const parsed = toPublicCancel(cancel({ status: "accepted", internalErrorCode: "not_eligible" }));
  assert.deepEqual(Object.keys(parsed).sort(), ["completedAt", "id", "orderId", "rejectedAt", "requestedAt", "status"]);
  const serialized = JSON.stringify(parsed);
  assert.equal(serialized.includes("providerOrderId"), false);
  assert.equal(serialized.includes("internalErrorCode"), false);
  assert.equal(serialized.includes("userId"), false);
});

test("cancel routes reject client fields and admin sync cannot send another cancel", () => {
  assert.equal(cancelRequestSchema.safeParse({}).success, true);
  assert.equal(cancelRequestSchema.safeParse({ userId: "user-a" }).success, false);
  assert.equal(cancelRequestSchema.safeParse({ providerOrderId: "100" }).success, false);
  assert.equal(cancelRequestSchema.safeParse({ amount: 100 }).success, false);
  assert.equal(cancelRequestSchema.safeParse({ status: "accepted" }).success, false);
  assert.equal(PROVIDER_CALL_POLICY.cancel.retry, false);
  const wrapper = source("src/lib/smmfull.ts");
  assert.match(wrapper, /action: "cancel"/);
  assert.match(wrapper, /orders: providerOrderId/);
  const admin = source("src/app/api/admin/cancellations/route.ts");
  const sync = source("src/app/api/admin/cancellations/[id]/sync/route.ts");
  assert.match(admin, /requireAdmin\(/);
  assert.match(sync, /requireAdmin\(/);
  assert.equal(sync.includes("requestCancel"), false);
  const firestore = source("src/lib/cancel/firestore.ts");
  const syncFn = firestore.slice(firestore.indexOf("export async function syncCancelStatus"), firestore.indexOf("export async function readCancelForUser"));
  assert.equal(syncFn.includes("requestCancel"), false);
  assert.match(syncFn, /getOrderStatus\(/);
  const rules = source("firestore.rules");
  const requestRule = rules.slice(rules.indexOf("match /cancelRequests/"), rules.indexOf("match /cancelSlots/"));
  const slotRule = rules.slice(rules.indexOf("match /cancelSlots/"), rules.indexOf("match /{document=**}"));
  assert.match(requestRule, /allow read, write: if false/);
  assert.match(slotRule, /allow read, write: if false/);
});
