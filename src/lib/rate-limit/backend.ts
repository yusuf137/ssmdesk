import { createHash } from "node:crypto";

import { ClosedRateLimitStore, MemoryRateLimitStore, type RateLimitStore } from "@/lib/rate-limit/store";
import { UpstashRateLimitStore, type UpstashConfig } from "@/lib/rate-limit/upstash-store";

export type RateLimitMode = "upstash" | "memory" | "unavailable";

export type RateLimitBackend = {
  mode: RateLimitMode;
  primary: RateLimitStore;
  fallback: RateLimitStore | null;
};

const UPSTASH_HOST = /^[a-z0-9-]+\.upstash\.io$/;

export function resolveRateLimitBackend(env: NodeJS.ProcessEnv): RateLimitBackend {
  const production = env.NODE_ENV === "production";
  const config = readUpstashConfig(env);

  if (config === "missing") {
    if (production) {
      return { mode: "unavailable", primary: new ClosedRateLimitStore(), fallback: null };
    }
    return { mode: "memory", primary: new MemoryRateLimitStore(), fallback: null };
  }

  if (config === "invalid") {
    return { mode: "unavailable", primary: new ClosedRateLimitStore(), fallback: null };
  }

  return {
    mode: "upstash",
    primary: new UpstashRateLimitStore(config),
    fallback: production ? null : new MemoryRateLimitStore(),
  };
}

export function readUpstashConfig(env: NodeJS.ProcessEnv): UpstashConfig | "missing" | "invalid" {
  const urlRaw = env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
  if (!urlRaw && !token) return "missing";
  if (!urlRaw || !token) return "invalid";

  let url: URL;
  try {
    url = new URL(urlRaw);
  } catch {
    return "invalid";
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !UPSTASH_HOST.test(url.hostname)
  ) {
    return "invalid";
  }

  return { url: url.origin, token };
}

let cachedKey = "";
let cached: RateLimitBackend | null = null;

export function getRateLimitBackend(): RateLimitBackend {
  const key = createHash("sha256")
    .update(
      [
        process.env.NODE_ENV ?? "",
        process.env.UPSTASH_REDIS_REST_URL ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
  if (cached && cachedKey === key) return cached;
  cached = resolveRateLimitBackend(process.env);
  cachedKey = key;
  return cached;
}
