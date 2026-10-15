import { RateLimitError, RateLimitStoreError } from "@/lib/http/errors";
import { getRateLimitBackend } from "@/lib/rate-limit/backend";
import { rateLimitKey, type RateLimitKind } from "@/lib/rate-limit/keys";
import type { RateLimitStore } from "@/lib/rate-limit/store";

export type { RateLimitStore } from "@/lib/rate-limit/store";
export { ClosedRateLimitStore, MemoryRateLimitStore } from "@/lib/rate-limit/store";
export { resolveRateLimitBackend } from "@/lib/rate-limit/backend";
export { rateLimitKey } from "@/lib/rate-limit/keys";
export { UpstashRateLimitStore } from "@/lib/rate-limit/upstash-store";

export type RateLimitSubject = {
  route: string;
  kind: RateLimitKind;
  value?: string;
};

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type StoreErrorReporter = (info: { scope: string }) => void;

let reportStoreError: StoreErrorReporter = () => {};

export function setRateLimitStoreErrorReporter(reporter: StoreErrorReporter): void {
  reportStoreError = reporter;
}

export async function enforceRateLimit(
  subject: RateLimitSubject,
  policy: RateLimitPolicy,
  options: {
    scope: string;
    critical: boolean;
    store?: RateLimitStore;
    fallback?: RateLimitStore | null;
  },
): Promise<void> {
  const key = rateLimitKey(subject.route, subject.kind, subject.value);
  const backend = options.store
    ? { primary: options.store, fallback: options.fallback ?? null }
    : getRateLimitBackend();

  let decision: { allowed: boolean; retryAfterSeconds: number };
  try {
    decision = await consume(backend.primary, key, policy);
  } catch {
    if (options.critical || !backend.fallback) {
      throw new RateLimitStoreError(options.scope);
    }
    reportStoreError({ scope: options.scope });
    try {
      decision = await consume(backend.fallback, key, policy);
    } catch {
      throw new RateLimitStoreError(options.scope);
    }
  }

  if (!decision.allowed) {
    throw new RateLimitError(options.scope, decision.retryAfterSeconds);
  }
}

async function consume(
  store: RateLimitStore,
  key: string,
  policy: RateLimitPolicy,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const count = await store.increment(key);
  let ttlMs = await store.ttl(key);
  if (ttlMs < 0) {
    await store.expire(key, policy.windowMs);
    ttlMs = policy.windowMs;
  }

  if (count > policy.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}
