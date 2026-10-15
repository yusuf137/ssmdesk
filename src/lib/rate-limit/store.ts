export interface RateLimitStore {
  increment(key: string): Promise<number>;
  get(key: string): Promise<number | null>;
  ttl(key: string): Promise<number>;
  expire(key: string, ttlMs: number): Promise<void>;
}

type Bucket = {
  count: number;
  expiresAt: number | null;
};

const DEFAULT_MAX_KEYS = 5_000;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = DEFAULT_MAX_KEYS,
  ) {}

  async increment(key: string): Promise<number> {
    const current = this.now();
    this.evict(current);
    const existing = this.buckets.get(key);
    if (!existing || (existing.expiresAt !== null && existing.expiresAt <= current)) {
      this.buckets.set(key, { count: 1, expiresAt: null });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  async get(key: string): Promise<number | null> {
    const current = this.now();
    const existing = this.buckets.get(key);
    if (!existing || (existing.expiresAt !== null && existing.expiresAt <= current)) return null;
    return existing.count;
  }

  async ttl(key: string): Promise<number> {
    const existing = this.buckets.get(key);
    if (!existing) return -2;
    if (existing.expiresAt === null) return -1;
    return Math.max(0, existing.expiresAt - this.now());
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    const existing = this.buckets.get(key);
    if (!existing) return;
    existing.expiresAt = this.now() + ttlMs;
  }

  private evict(current: number): void {
    if (this.buckets.size < this.maxKeys) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt !== null && bucket.expiresAt <= current) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

export class ClosedRateLimitStore implements RateLimitStore {
  async increment(): Promise<number> {
    throw new Error("rate_limit_unconfigured");
  }

  async get(): Promise<number | null> {
    throw new Error("rate_limit_unconfigured");
  }

  async ttl(): Promise<number> {
    throw new Error("rate_limit_unconfigured");
  }

  async expire(): Promise<void> {
    throw new Error("rate_limit_unconfigured");
  }
}
