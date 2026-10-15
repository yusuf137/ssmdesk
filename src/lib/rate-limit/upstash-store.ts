import type { RateLimitStore } from "@/lib/rate-limit/store";

export type UpstashConfig = {
  url: string;
  token: string;
};

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

const COMMAND_TIMEOUT_MS = 2_000;

export class UpstashRateLimitStore implements RateLimitStore {
  constructor(
    private readonly config: UpstashConfig,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async increment(key: string): Promise<number> {
    return this.commandNumber(["INCR", key]);
  }

  async get(key: string): Promise<number | null> {
    const result = await this.command(["GET", key]);
    if (result === null) return null;
    const count = typeof result === "number" ? result : Number(result);
    return Number.isSafeInteger(count) ? count : null;
  }

  async ttl(key: string): Promise<number> {
    return this.commandNumber(["PTTL", key]);
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    await this.command(["PEXPIRE", key, String(Math.max(1, Math.ceil(ttlMs)))]);
  }

  private async commandNumber(command: string[]): Promise<number> {
    const result = await this.command(command);
    const count = typeof result === "number" ? result : Number(result);
    if (!Number.isFinite(count)) throw new Error("upstash_request_failed");
    return count;
  }

  private async command(command: string[]): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error("upstash_request_failed");
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null || !("result" in payload)) {
        throw new Error("upstash_request_failed");
      }
      if ("error" in payload && payload.error) throw new Error("upstash_request_failed");
      return payload.result;
    } catch (error) {
      if (error instanceof Error && error.message === "upstash_request_failed") throw error;
      throw new Error("upstash_request_failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
