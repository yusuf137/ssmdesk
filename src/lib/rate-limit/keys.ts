import { createHash } from "node:crypto";

const ROUTE_PATTERN = /^[a-z0-9-]{1,32}$/;

export type RateLimitKind = "global" | "user" | "ip" | "email";

export function rateLimitKey(route: string, kind: RateLimitKind, value?: string): string {
  if (!ROUTE_PATTERN.test(route)) {
    throw new Error("invalid_rate_limit_route");
  }
  if (kind === "global") return `rl:${route}:global`;

  const normalized = normalizeSubject(kind, value);
  const digest = createHash("sha256").update(`${kind}:${normalized}`, "utf8").digest("hex");
  return `rl:${route}:${kind}:${digest}`;
}

function normalizeSubject(kind: Exclude<RateLimitKind, "global">, value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0 || trimmed.length > 320) {
    throw new Error("invalid_rate_limit_subject");
  }
  if (kind === "email" || kind === "ip") return trimmed.toLowerCase();
  return trimmed;
}
