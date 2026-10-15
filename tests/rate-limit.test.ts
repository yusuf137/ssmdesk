import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { RateLimitError, RateLimitStoreError, toPublicError } from "../src/lib/http/errors";
import {
  enforceRateLimit,
  MemoryRateLimitStore,
  rateLimitKey,
  resolveRateLimitBackend,
  UpstashRateLimitStore,
} from "../src/lib/http/rate-limit";
import type { RateLimitStore } from "../src/lib/rate-limit/store";

const root = join(import.meta.dirname, "..");

test("rate limit keys hash user and ip values", () => {
  const userKey = rateLimitKey("orders-create", "user", "firebase-uid-1");
  const otherUser = rateLimitKey("orders-create", "user", "firebase-uid-2");
  const ipKey = rateLimitKey("orders-create", "ip", "203.0.113.8");
  const emailKey = rateLimitKey("login", "email", "Person@Example.com");
  const sameEmail = rateLimitKey("login", "email", "person@example.com");

  assert.match(userKey, /^rl:orders-create:user:[a-f0-9]{64}$/);
  assert.notEqual(userKey, otherUser);
  assert.equal(userKey.includes("firebase-uid-1"), false);
  assert.equal(ipKey.includes("203.0.113.8"), false);
  assert.equal(emailKey.includes("Example.com"), false);
  assert.equal(emailKey, sameEmail);
  assert.equal(rateLimitKey("orders-create", "global"), "rl:orders-create:global");
});

test("distributed store keeps separate buckets per user", async () => {
  const store = new MockStore();
  const policy = { limit: 1, windowMs: 60_000 };
  const options = { scope: "orders_user", critical: true, store, fallback: null };
  await enforceRateLimit({ route: "orders-create", kind: "user", value: "user-a" }, policy, options);
  await assert.rejects(
    () => enforceRateLimit({ route: "orders-create", kind: "user", value: "user-a" }, policy, options),
    (error: unknown) => error instanceof RateLimitError && error.status === 429 && error.code === "TOO_MANY_REQUESTS",
  );
  await enforceRateLimit({ route: "orders-create", kind: "user", value: "user-b" }, policy, options);
  const storedKeys = [...store.counts.keys()];
  assert.equal(storedKeys.some((key) => key.includes("user-a") || key.includes("user-b")), false);
});

test("retry after is exposed for rate limit responses", async () => {
  const store = new MemoryRateLimitStore();
  const policy = { limit: 1, windowMs: 5_000 };
  const options = { scope: "login_ip", critical: true, store, fallback: null };
  await enforceRateLimit({ route: "login", kind: "ip", value: "198.51.100.4" }, policy, options);
  let error: unknown;
  try {
    await enforceRateLimit({ route: "login", kind: "ip", value: "198.51.100.4" }, policy, options);
    assert.fail("expected rate limit");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof RateLimitError);
  const mapped = toPublicError(error, "11111111-1111-4111-8111-111111111111");
  assert.equal(mapped.status, 429);
  assert.equal(mapped.body.error, "TOO_MANY_REQUESTS");
  assert.ok((mapped.retryAfterSeconds ?? 0) >= 1);
  const handler = readFileSync(join(root, "src/lib/http/api-handler.ts"), "utf8");
  assert.match(handler, /Retry-After/);
  assert.match(handler, /RATE_LIMIT_HIT/);
  assert.match(handler, /RATE_LIMIT_STORE_ERROR/);
});

test("production without upstash fails closed", async () => {
  const backend = resolveRateLimitBackend({ NODE_ENV: "production" });
  assert.equal(backend.mode, "unavailable");
  assert.equal(backend.fallback, null);
  await assert.rejects(
    () =>
      enforceRateLimit(
        { route: "orders-create", kind: "global" },
        { limit: 10, windowMs: 60_000 },
        { scope: "orders_create_global", critical: true, store: backend.primary, fallback: backend.fallback },
      ),
    (error: unknown) => error instanceof RateLimitStoreError && error.status === 503 && error.code === "SERVICE_UNAVAILABLE",
  );
});

test("development without upstash uses memory", async () => {
  const backend = resolveRateLimitBackend({ NODE_ENV: "development" });
  assert.equal(backend.mode, "memory");
  await enforceRateLimit(
    { route: "services", kind: "global" },
    { limit: 2, windowMs: 60_000 },
    { scope: "services_global", critical: false, store: backend.primary, fallback: backend.fallback },
  );
});

test("invalid upstash config does not fall back in development", () => {
  const backend = resolveRateLimitBackend({
    NODE_ENV: "development",
    UPSTASH_REDIS_REST_URL: "https://evil.example/redis",
    UPSTASH_REDIS_REST_TOKEN: "token-value",
  });
  assert.equal(backend.mode, "unavailable");
  assert.equal(backend.fallback, null);
});

test("redis errors on critical posts do not fail open", async () => {
  await assert.rejects(
    () =>
      enforceRateLimit(
        { route: "orders-create", kind: "global" },
        { limit: 10, windowMs: 60_000 },
        { scope: "orders_create_global", critical: true, store: new FailingStore(), fallback: new MemoryRateLimitStore() },
      ),
    (error: unknown) => error instanceof RateLimitStoreError && error.code === "SERVICE_UNAVAILABLE",
  );
});

test("browse traffic can use the development fallback store", async () => {
  const fallback = new MemoryRateLimitStore();
  await enforceRateLimit(
    { route: "services", kind: "global" },
    { limit: 2, windowMs: 60_000 },
    { scope: "services_global", critical: false, store: new FailingStore(), fallback },
  );
  assert.equal(await fallback.get(rateLimitKey("services", "global")), 1);
});

test("upstash client does not put the token in errors", async () => {
  const token = "super-secret-upstash-token";
  const store = new UpstashRateLimitStore({ url: "https://example.upstash.io", token }, async () => {
    return new Response("denied", { status: 500 });
  });
  await assert.rejects(
    () => store.increment("rl:orders-create:global"),
    (error: unknown) => error instanceof Error && error.message === "upstash_request_failed" && !error.message.includes(token),
  );
});

class MockStore implements RateLimitStore {
  readonly counts = new Map<string, number>();
  private readonly ttls = new Map<string, number>();

  async increment(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  async get(key: string): Promise<number | null> {
    return this.counts.get(key) ?? null;
  }

  async ttl(key: string): Promise<number> {
    return this.ttls.get(key) ?? -1;
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    this.ttls.set(key, ttlMs);
  }
}

class FailingStore implements RateLimitStore {
  async increment(): Promise<number> {
    throw new Error("redis down");
  }

  async get(): Promise<number | null> {
    throw new Error("redis down");
  }

  async ttl(): Promise<number> {
    throw new Error("redis down");
  }

  async expire(): Promise<void> {
    throw new Error("redis down");
  }
}
