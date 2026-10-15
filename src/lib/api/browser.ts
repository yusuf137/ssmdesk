import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/constants";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Invalid request path");
  }

  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
}

export function readPublicMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("message" in payload) || !("error" in payload)) return null;
  const { message, error } = payload;
  if (typeof message !== "string" || typeof error !== "string") return null;
  if (!/^[A-Z0-9_]{1,64}$/.test(error)) return null;
  if (message.length === 0 || message.length > 200) return null;
  return message;
}
