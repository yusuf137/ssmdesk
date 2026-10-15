import { AppError } from "@/lib/http/errors";
import { trustProxy } from "@/lib/http/client-ip";

const DEFAULT_ORIGIN = "http://localhost:3000";

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.origin !== value.trim()) return null;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim() || DEFAULT_ORIGIN;
  const origins = raw
    .split(",")
    .map((item) => parseOrigin(item))
    .filter((item): item is string => item !== null);

  return origins.length > 0 ? origins : [DEFAULT_ORIGIN];
}

function requestOrigin(request: Request): string | null {
  if (trustProxy()) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (
      forwardedHost &&
      /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(forwardedHost) &&
      (forwardedProto === "http" || forwardedProto === "https")
    ) {
      return `${forwardedProto}://${forwardedHost}`;
    }
  }

  const host = request.headers.get("host")?.split(",")[0]?.trim() ?? "";
  if (/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host)) {
    try {
      const protocol = new URL(request.url).protocol;
      if (protocol === "http:" || protocol === "https:") return `${protocol}//${host}`;
    } catch {
      return `http://${host}`;
    }
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin === "null") {
    throw new AppError("FORBIDDEN_ORIGIN", 403, "İstek reddedildi.");
  }

  const sameOrigin = requestOrigin(request);
  if (origin === sameOrigin) return;
  if (getAllowedOrigins().includes(origin)) return;

  throw new AppError("FORBIDDEN_ORIGIN", 403, "İstek reddedildi.");
}
