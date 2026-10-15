import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AppError } from "../src/lib/http/errors";
import { toPublicOrder } from "../src/lib/orders/public-order";
import type { OrderRecord } from "../src/lib/orders/repository";
import {
  classifyProviderFailure,
  compareProviderFunds,
  decideProviderSubmitClaim,
  runProviderSubmission,
  type SubmissionPorts,
  type SubmissionSnapshot,
} from "../src/lib/provider/submission";

const root = join(import.meta.dirname, "..");

function snapshot(overrides: Partial<SubmissionSnapshot> = {}): SubmissionSnapshot {
  return {
    status: "paid",
    userId: "user-a",
    serviceId: 7,
    targetUrl: "https://example.com/p/1",
    quantity: 100,
    salePriceMinor: 1800,
    providerCostMinor: 500,
    providerCurrency: "USD",
    providerOrderId: null,
    submissionAttemptId: null,
    submissionAttemptCount: 0,
    ...overrides,
  };
}

function harness(initial: SubmissionSnapshot, options: {
  balance?: { balanceMinor: number; currency: string | null };
  fail?: unknown;
  allowUnknown?: boolean;
} = {}) {
  let current = { ...initial };
  let calls = 0;
  let refunds = 0;
  let chain = Promise.resolve();
  const allowUnknown = options.allowUnknown === true;
  const balance = options.balance ?? { balanceMinor: 10_000, currency: "USD" };

  function exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const ports: SubmissionPorts = {
    claim: (attemptId) =>
      exclusive(() => {
        const decision = decideProviderSubmitClaim({
          status: current.status,
          providerOrderId: current.providerOrderId,
          allowUnknownRetry: allowUnknown,
        });
        if (decision !== "claim") return { ok: false, reason: decision };
        current = {
          ...current,
          status: "submitting",
          submissionAttemptId: attemptId,
          submissionAttemptCount: current.submissionAttemptCount + 1,
        };
        return { ok: true, snapshot: current };
      }),
    rememberCurrency: (attemptId, currency) =>
      exclusive(() => {
        if (current.submissionAttemptId !== attemptId || current.status !== "submitting") return false;
        current = { ...current, providerCurrency: currency };
        return true;
      }),
    release: (attemptId) =>
      exclusive(() => {
        if (current.submissionAttemptId !== attemptId || current.providerOrderId) return;
        current = { ...current, status: "checking_provider_balance" };
      }),
    markAwaiting: (attemptId) =>
      exclusive(() => {
        if (current.submissionAttemptId !== attemptId) return;
        current = { ...current, status: "awaiting_provider_funds" };
      }),
    markUnknown: (attemptId, _now, errorCode) =>
      exclusive(() => {
        if (current.submissionAttemptId !== attemptId) return;
        current = { ...current, status: "submission_unknown", submissionAttemptId: `${attemptId}:${errorCode}` };
      }),
    markRejected: (attemptId) =>
      exclusive(() => {
        if (current.submissionAttemptId !== attemptId || current.providerOrderId) return false;
        current = { ...current, status: "failed" };
        return true;
      }),
    markSubmitted: (attemptId, _now, providerOrderId) =>
      exclusive(() => {
        if (current.submissionAttemptId !== attemptId || current.status !== "submitting" || current.providerOrderId) {
          return false;
        }
        current = { ...current, status: "in_progress", providerOrderId };
        return true;
      }),
    getBalance: async () => balance,
    createOrder: async () => {
      calls += 1;
      if (options.fail) throw options.fail;
      return { providerOrderId: "1001" };
    },
    refund: async () => {
      if (current.status !== "failed") return "not_refundable";
      refunds += 1;
      current = { ...current, status: "refunded" };
      return "refunded";
    },
  };

  return {
    ports,
    allowUnknown,
    current: () => current,
    calls: () => calls,
    refunds: () => refunds,
  };
}

function run(box: ReturnType<typeof harness>, attemptId = "attempt-1") {
  return runProviderSubmission({
    orderId: "a".repeat(64),
    allowUnknownRetry: box.allowUnknown,
    now: "2026-10-15T00:00:00.000Z",
    attemptId,
    ports: box.ports,
  });
}

test("a paid order makes one provider call and a second submit does not", async () => {
  const box = harness(snapshot());
  assert.equal(await run(box, "one"), "in_progress");
  assert.equal(await run(box, "two"), "duplicate");
  assert.equal(box.calls(), 1);
  assert.equal(box.current().providerOrderId, "1001");
  assert.equal(box.current().status, "in_progress");
});

test("an existing provider order id is not submitted again", async () => {
  const box = harness(snapshot({ providerOrderId: "55", status: "in_progress" }));
  assert.equal(await run(box), "duplicate");
  assert.equal(box.calls(), 0);
});

test("low provider balance waits and does not create an order", async () => {
  const box = harness(snapshot(), { balance: { balanceMinor: 100, currency: "USD" } });
  assert.equal(await run(box), "awaiting_provider_funds");
  assert.equal(box.calls(), 0);
  assert.equal(box.refunds(), 0);
});

test("a definitive provider reject refunds once", async () => {
  const box = harness(snapshot(), {
    fail: new AppError("PROVIDER_REJECTED", 502, "Sipariş oluşturulamadı.", "provider_error:Incorrect service ID"),
  });
  assert.equal(await run(box, "reject"), "refunded");
  assert.equal(await run(box, "again"), "blocked");
  assert.equal(box.calls(), 1);
  assert.equal(box.refunds(), 1);
  assert.equal(box.current().status, "refunded");
});

test("timeout and network errors stay unknown and do not refund", async () => {
  const timeout = harness(snapshot(), {
    fail: new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_network"),
  });
  assert.equal(await run(timeout, "net"), "submission_unknown");
  assert.equal(timeout.refunds(), 0);
  assert.equal(timeout.calls(), 1);
  assert.equal(await run(timeout, "auto"), "blocked");
  assert.equal(timeout.calls(), 1);

  const http = harness(snapshot(), {
    fail: new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_http_502"),
  });
  assert.equal(await run(http, "http"), "submission_unknown");
  assert.equal(http.refunds(), 0);
});

test("unknown orders are not retried unless an admin confirms", async () => {
  const blocked = harness(snapshot({ status: "submission_unknown" }));
  assert.equal(await run(blocked), "blocked");
  assert.equal(blocked.calls(), 0);
  const confirmed = harness(snapshot({ status: "submission_unknown" }), { allowUnknown: true });
  assert.equal(await run(confirmed, "admin"), "in_progress");
  assert.equal(confirmed.calls(), 1);
});

test("different provider currencies block submission", async () => {
  const box = harness(snapshot({ providerCurrency: "USD" }), { balance: { balanceMinor: 10_000, currency: "TRY" } });
  assert.equal(await run(box), "currency_mismatch");
  assert.equal(box.calls(), 0);
  assert.equal(box.refunds(), 0);
  assert.equal(compareProviderFunds({ costCurrency: "USD", balanceCurrency: null, costMinor: 1, balanceMinor: 1 }), "mismatch");
});

test("concurrent claims send one provider order", async () => {
  const box = harness(snapshot());
  const results = await Promise.all([run(box, "left"), run(box, "right")]);
  assert.equal(results.filter((result) => result === "in_progress").length, 1);
  assert.equal(box.calls(), 1);
});

test("provider cost stays off the public order and failure kinds stay strict", () => {
  const record: OrderRecord = {
    id: "b".repeat(64),
    userId: "user-a",
    serviceId: 7,
    serviceName: "Takipçi",
    category: "Instagram",
    targetUrl: "https://example.com/p/1",
    quantity: 100,
    currency: "TRY",
    salePriceMinor: 1800,
    pricingRole: "user",
    pricingMultiplier: 1.8,
    provider: "smmfull",
    providerOrderId: null,
    providerStatus: null,
    status: "in_progress",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
  const pub = toPublicOrder(record);
  assert.equal("providerOrderId" in pub, false);
  assert.equal("supplierMinor" in pub, false);
  assert.equal(classifyProviderFailure({ code: "PROVIDER_REJECTED", detail: "provider_error:Not enough funds on balance" }), "insufficient_balance");
  assert.equal(classifyProviderFailure({ code: "PROVIDER_REJECTED", detail: "provider_error:Incorrect service ID" }), "definitive_reject");
  assert.equal(classifyProviderFailure({ code: "PROVIDER_UNAVAILABLE", detail: "provider_invalid_json" }), "ambiguous");
  const submit = readFileSync(join(root, "src/lib/payments/submit-paid-order.ts"), "utf8");
  const provider = readFileSync(join(root, "src/lib/provider/submit-order.ts"), "utf8");
  const route = readFileSync(join(root, "src/app/api/admin/orders/[id]/retry-provider/route.ts"), "utf8");
  assert.equal(submit.includes("createOrder("), false);
  assert.match(provider, /createOrder\(/);
  assert.match(route, /requireAdmin\(/);
  assert.equal(provider.includes("action=add"), false);
});
