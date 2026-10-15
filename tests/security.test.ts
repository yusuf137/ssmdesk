import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { PROVIDER_CALL_POLICY } from "../src/lib/constants";
import { assertAllowedOrigin, getAllowedOrigins } from "../src/lib/http/origin";
import { getClientIp } from "../src/lib/http/client-ip";
import { resolveRequestId } from "../src/lib/http/request-id";
import { enforceRateLimit, MemoryRateLimitStore } from "../src/lib/http/rate-limit";
import { RateLimitError } from "../src/lib/http/errors";
import { redact } from "../src/lib/logging/redact";
import { resolveSalePrice } from "../src/lib/services/pricing";
import { publicServiceSchema, toPublicService } from "../src/lib/services/public-service";
import { isUserRole } from "../src/lib/auth/roles";
import { loginSchema, registerSchema } from "../src/lib/validation/auth";

const root = join(import.meta.dirname, "..");

test("public service payload cannot carry provider cost", () => {
  const service = toPublicService({
    id: 12,
    name: "Takipçi",
    category: "Instagram",
    type: "Standart",
    salePrice: 15,
    min: 100,
    max: 1000,
    refill: true,
    cancel: false,
  });

  assert.deepEqual(Object.keys(service).sort(), [
    "cancel",
    "category",
    "id",
    "max",
    "min",
    "name",
    "refill",
    "salePrice",
    "type",
  ]);

  const leaked = publicServiceSchema.safeParse({ ...service, costPrice: 4, providerCost: 4, rate: 4 });
  assert.equal(leaked.success, false);
});

test("sale price uses an override and otherwise applies the multiplier", () => {
  assert.equal(resolveSalePrice(10, 1.5, 25), 25);
  assert.equal(resolveSalePrice(10, 1.5, null), 15);
  assert.equal(resolveSalePrice(10, 1.5, 0), null);
});

test("auth schemas reject unexpected fields", () => {
  assert.equal(loginSchema.safeParse({ email: "a@b.co", password: "secret", role: "admin" }).success, false);
  assert.equal(
    registerSchema.safeParse({ email: "a@b.co", password: "secret1", userId: "other" }).success,
    false,
  );
  assert.equal(registerSchema.safeParse({ email: "a@b.co", password: "secret12" }).success, true);
  assert.equal(isUserRole("admin"), true);
  assert.equal(isUserRole("Admin"), false);
});

test("memory limiter blocks the request after the limit", async () => {
  let now = 1_000;
  const store = new MemoryRateLimitStore(() => now, 10);
  const policy = { limit: 2, windowMs: 1_000 };
  const subject = { route: "login", kind: "user" as const, value: "user-memory" };
  const options = { scope: "login_user", critical: true, store, fallback: null };
  await enforceRateLimit(subject, policy, options);
  await enforceRateLimit(subject, policy, options);
  await assert.rejects(
    () => enforceRateLimit(subject, policy, options),
    (error: unknown) => error instanceof RateLimitError && (error.retryAfterSeconds ?? 0) >= 1,
  );
  now = 2_100;
  await enforceRateLimit(subject, policy, options);
});

test("logs redact secrets by key and by value", () => {
  const redacted = redact(
    {
      authorization: "Bearer secret",
      password: "hunter2",
      nested: { apiKey: "abc", note: "token super-secret-value inside" },
      userId: "user-1",
    },
    ["super-secret-value"],
  );

  assert.deepEqual(redacted, {
    authorization: "[redacted]",
    password: "[redacted]",
    nested: { apiKey: "[redacted]", note: "token [redacted] inside" },
    userId: "user-1",
  });
});

test("request ids from outside the generator are replaced", () => {
  assert.notEqual(resolveRequestId("not-a-uuid"), "not-a-uuid");
  assert.notEqual(resolveRequestId("../../../etc/passwd"), "../../../etc/passwd");
  assert.match(resolveRequestId(null), /^[0-9a-f-]{36}$/i);
});

test("spoofed forwarding headers are ignored unless the proxy is trusted", () => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "false";
  const spoofed = new Request("http://localhost:3000/api/services", {
    headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "8.8.8.8" },
  });
  assert.equal(getClientIp(spoofed), null);

  process.env.TRUST_PROXY = "true";
  assert.equal(getClientIp(spoofed), "1.2.3.4");
  const chained = new Request("http://localhost:3000/api/services", {
    headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4", "x-real-ip": "8.8.8.8" },
  });
  assert.equal(getClientIp(chained), "1.2.3.4");
  const realIpOnly = new Request("http://localhost:3000/api/services", {
    headers: { "x-real-ip": "8.8.8.8" },
  });
  assert.equal(getClientIp(realIpOnly), null);
  restoreEnv("TRUST_PROXY", previous);
});

test("browser origin is compared with the host the client called", () => {
  const request = new Request("http://internal.invalid/api/auth/login", {
    headers: {
      host: "127.0.0.1:3456",
      origin: "http://127.0.0.1:3456",
    },
  });
  assert.doesNotThrow(() => assertAllowedOrigin(request));

  const foreign = new Request("http://127.0.0.1:3456/api/auth/login", {
    headers: {
      host: "127.0.0.1:3456",
      origin: "http://evil.example",
    },
  });
  assert.throws(() => assertAllowedOrigin(foreign));
});

test("wildcard origins are not allowed", () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "*";
  assert.deepEqual(getAllowedOrigins(), ["http://localhost:3000"]);
  restoreEnv("ALLOWED_ORIGINS", previous);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("order creation is not retried", () => {
  assert.equal(PROVIDER_CALL_POLICY.createOrder.retry, false);
  assert.equal(PROVIDER_CALL_POLICY.services.retry, true);
});

test("source does not expose the provider key or render raw html", () => {
  const files = walk(join(root, "src"));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const path = relative(root, file).replaceAll("\\", "/");
    assert.equal(text.includes("NEXT_PUBLIC_SMMFULL"), false, path);
    assert.equal(text.includes("dangerouslySetInnerHTML"), false, path);
    if (path.startsWith("src/components/") || path.startsWith("src/app/")) {
      assert.equal(text.includes("SMMFULL_API_KEY"), false, path);
      assert.equal(text.includes("FIREBASE_PRIVATE_KEY"), false, path);
      assert.equal(text.includes("costPrice"), false, path);
      assert.equal(text.includes("providerCost"), false, path);
    }
  }
});

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) files.push(path);
  }
  return files;
}
