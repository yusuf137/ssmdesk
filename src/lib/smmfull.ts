import "server-only";

import { z } from "zod";

import {
  MAX_ORDER_QUANTITY,
  MAX_PROVIDER_SERVICES,
  MAX_TARGET_LENGTH,
  PROVIDER_CALL_POLICY,
  PROVIDER_MAX_RESPONSE_BYTES,
  PROVIDER_RETRY_DELAY_MS,
  SERVICE_CATALOG_CACHE_MS,
  TEXT_LIMITS,
} from "@/lib/constants";
import { getSmmConfig } from "@/lib/env/server";
import { AppError } from "@/lib/http/errors";
import { logInfo, logWarn } from "@/lib/logging/logger";
import { interpretCancelPayload } from "@/lib/cancel/policy";
import { parseProviderRate, providerAmountToMinor } from "@/lib/provider/money";
import type {
  ProviderBalance,
  ProviderCreateOrderInput,
  ProviderCreateOrderResult,
  ProviderOrderStatus,
  ProviderService,
  SmmProvider,
} from "@/lib/smm/provider";

const providerServiceSchema = z.object({
  service: z.union([z.number(), z.string()]),
  name: z.string(),
  category: z.string().optional(),
  type: z.string().optional(),
  rate: z.union([z.number(), z.string()]),
  min: z.union([z.number(), z.string()]),
  max: z.union([z.number(), z.string()]),
  refill: z.union([z.boolean(), z.number(), z.string()]).optional(),
  cancel: z.union([z.boolean(), z.number(), z.string()]).optional(),
});

const RETRYABLE = "PROVIDER_RETRYABLE";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function parseNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseProviderService(value: unknown): ProviderService | null {
  const parsed = providerServiceSchema.safeParse(value);
  if (!parsed.success) return null;

  const id = parseNumber(parsed.data.service);
  const costPrice = parseProviderRate(parsed.data.rate);
  const min = parseNumber(parsed.data.min);
  const max = parseNumber(parsed.data.max);
  const name = cleanText(parsed.data.name, TEXT_LIMITS.serviceName);

  if (
    id === null ||
    !Number.isInteger(id) ||
    id <= 0 ||
    costPrice === null ||
    costPrice < 0 ||
    min === null ||
    max === null ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 0 ||
    max < min ||
    max <= 0 ||
    name.length === 0
  ) {
    return null;
  }

  return {
    id,
    name,
    category: cleanText(parsed.data.category ?? "Diğer", TEXT_LIMITS.category) || "Diğer",
    type: cleanText(parsed.data.type ?? "", TEXT_LIMITS.serviceType) || "Standart",
    costPrice,
    min,
    max,
    refill: parseFlag(parsed.data.refill),
    cancel: parseFlag(parsed.data.cancel),
  };
}

function providerTarget(input: ProviderCreateOrderInput): string {
  if (typeof input.targetUrl === "string" && input.targetUrl.trim().length > 0) return input.targetUrl;
  return input.link ?? "";
}

function assertOrderInput(input: ProviderCreateOrderInput): void {
  const link = providerTarget(input);
  if (
    !Number.isInteger(input.serviceId) ||
    input.serviceId <= 0 ||
    input.serviceId > MAX_ORDER_QUANTITY ||
    !Number.isInteger(input.quantity) ||
    input.quantity <= 0 ||
    input.quantity > MAX_ORDER_QUANTITY ||
    typeof link !== "string" ||
    link.trim().length === 0 ||
    link.length > MAX_TARGET_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(link)
  ) {
    throw new AppError("INVALID_REQUEST", 400, "Sipariş bilgileri geçersiz.");
  }
}

function safeProviderCode(value: unknown): string {
  if (typeof value !== "string") return "unrecognized";
  const code = value.slice(0, 80);
  return /^[A-Za-z0-9_ .:/-]+$/.test(code) ? code : "unrecognized";
}

async function readProviderBody(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > PROVIDER_MAX_RESPONSE_BYTES) {
    throw new AppError(RETRYABLE, 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_body_too_large");
  }

  const text = await response.text();
  if (text.length > PROVIDER_MAX_RESPONSE_BYTES) {
    throw new AppError(RETRYABLE, 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_body_too_large");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_invalid_json");
  }
}

async function callOnce(fields: Record<string, string>): Promise<unknown> {
  const config = getSmmConfig();
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (key === "key") continue;
    body.set(key, value);
  }
  body.set("key", config.apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "smm-panel/0.1",
        },
        body,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new AppError(RETRYABLE, 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_network");
    }

    if (response.status === 429 || response.status >= 500) {
      throw new AppError(RETRYABLE, 503, "Hizmet sağlayıcısına ulaşılamadı.", `provider_http_${response.status}`);
    }

    const payload = await readProviderBody(response);
    if (!response.ok) {
      throw new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet sağlayıcısına ulaşılamadı.", `provider_http_${response.status}`);
    }

    if (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "error" in payload
    ) {
      const code = safeProviderCode((payload as { error?: unknown }).error);
      throw new AppError("PROVIDER_REJECTED", 502, "Hizmet sağlayıcısı isteği reddetti.", `provider_error:${code}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function callSmmFull(
  fields: Record<string, string>,
  options: { retry: boolean; action: string },
): Promise<unknown> {
  const attempts = options.retry ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      const payload = await callOnce(fields);
      logInfo("provider_request", {
        action: options.action,
        attempt,
        result: "success",
        latencyMs: Date.now() - started,
      });
      return payload;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AppError && error.code === RETRYABLE;
      logWarn("provider_request", {
        action: options.action,
        attempt,
        result: retryable ? "retryable_failure" : "failure",
        latencyMs: Date.now() - started,
        code: error instanceof AppError ? error.internalMessage ?? error.code : "unknown",
      });
      if (!retryable || attempt === attempts) break;
      await delay(PROVIDER_RETRY_DELAY_MS);
    }
  }

  if (lastError instanceof AppError && lastError.code === RETRYABLE) {
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "Hizmet sağlayıcısına ulaşılamadı.",
      lastError.internalMessage,
    );
  }

  throw lastError;
}

function normalizeServices(payload: unknown): ProviderService[] {
  const records = Array.isArray(payload)
    ? payload
    : payload !== null && typeof payload === "object"
      ? Object.values(payload)
      : null;

  if (!records) {
    throw new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet listesi alınamadı.", "provider_services_shape");
  }

  const services: ProviderService[] = [];
  let dropped = 0;
  for (const record of records) {
    if (services.length >= MAX_PROVIDER_SERVICES) break;
    const service = parseProviderService(record);
    if (!service) {
      dropped += 1;
      continue;
    }
    services.push(service);
  }

  if (dropped > 0) {
    logWarn("provider_services_dropped", { dropped, kept: services.length });
  }

  return services;
}

function sanitizeStatus(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!normalized) return "unknown";
  return normalized.slice(0, TEXT_LIMITS.providerStatus);
}

export class SmmFullProvider implements SmmProvider {
  // Normalized service fields only. The provider API key is not stored.
  private catalogCache: { expiresAt: number; services: ProviderService[] } | null = null;
  private catalogInflight: Promise<ProviderService[]> | null = null;

  async getServices(): Promise<ProviderService[]> {
    const now = Date.now();
    if (this.catalogCache && this.catalogCache.expiresAt > now) {
      return this.catalogCache.services;
    }

    if (!this.catalogInflight) {
      this.catalogInflight = this.loadServices().finally(() => {
        this.catalogInflight = null;
      });
    }

    return this.catalogInflight;
  }

  async createOrder(input: ProviderCreateOrderInput): Promise<ProviderCreateOrderResult> {
    assertOrderInput(input);
    // The target link is form data for the provider. This server does not request it.
    const payload = await callSmmFull(
      {
        action: "add",
        service: String(input.serviceId),
        link: providerTarget(input),
        quantity: String(input.quantity),
      },
      { retry: PROVIDER_CALL_POLICY.createOrder.retry, action: "add" },
    );

    const parsed = z.object({ order: z.union([z.number(), z.string()]) }).safeParse(payload);
    const providerOrderId = parsed.success ? String(parsed.data.order) : "";
    if (!/^\d{1,20}$/.test(providerOrderId)) {
      throw new AppError("PROVIDER_REJECTED", 502, "Sipariş oluşturulamadı.", "provider_order_id_missing");
    }

    return { providerOrderId };
  }

  async getOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus> {
    if (!/^\d{1,20}$/.test(providerOrderId)) {
      throw new AppError("INVALID_REQUEST", 400, "Sipariş bulunamadı.");
    }

    const payload = await callSmmFull(
      { action: "status", order: providerOrderId },
      { retry: PROVIDER_CALL_POLICY.orderStatus.retry, action: "status" },
    );

    const parsed = z
      .object({
        status: z.string().optional(),
        charge: z.union([z.number(), z.string()]).optional(),
        start_count: z.union([z.number(), z.string()]).optional(),
        remains: z.union([z.number(), z.string()]).optional(),
      })
      .safeParse(payload);

    if (!parsed.success) {
      throw new AppError("PROVIDER_UNAVAILABLE", 503, "Sipariş durumu alınamadı.", "provider_status_shape");
    }

    return {
      providerOrderId,
      status: sanitizeStatus(parsed.data.status),
      charge: parseNumber(parsed.data.charge),
      startCount: parseNumber(parsed.data.start_count),
      remains: parseNumber(parsed.data.remains),
    };
  }

  async getBalance(): Promise<ProviderBalance> {
    const payload = await callSmmFull(
      { action: "balance" },
      { retry: PROVIDER_CALL_POLICY.balance.retry, action: "balance" },
    );
    const parsed = z
      .object({
        balance: z.union([z.number(), z.string()]),
        currency: z.string().optional(),
      })
      .safeParse(payload);

    const balanceMinor = parsed.success ? providerAmountToMinor(parsed.data.balance) : null;
    const balance = parsed.success ? parseNumber(parsed.data.balance) : null;
    if (balance === null || balanceMinor === null) {
      throw new AppError("PROVIDER_UNAVAILABLE", 503, "Bakiye alınamadı.", "provider_balance_shape");
    }

    const currency = parsed.success ? cleanText(parsed.data.currency ?? "", 12).toUpperCase() : "";
    return { balance, balanceMinor, currency: currency || null };
  }

  async requestRefill(providerOrderId: string): Promise<{ providerRefillId: string }> {
    if (!/^\d{1,20}$/.test(providerOrderId)) {
      throw new AppError("INVALID_REQUEST", 400, "Bu sipariş refill için uygun değil.");
    }
    const payload = await callSmmFull(
      { action: "refill", order: providerOrderId },
      { retry: PROVIDER_CALL_POLICY.refill.retry, action: "refill" },
    );
    const parsed = z.object({ refill: z.union([z.number(), z.string()]) }).safeParse(payload);
    const providerRefillId = parsed.success ? String(parsed.data.refill) : "";
    if (!/^\d{1,20}$/.test(providerRefillId)) {
      throw new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_refill_id_missing");
    }
    return { providerRefillId };
  }

  async getRefillStatus(providerRefillId: string): Promise<{ providerRefillId: string; status: string }> {
    if (!/^\d{1,20}$/.test(providerRefillId)) {
      throw new AppError("INVALID_REQUEST", 400, "Refill talebi bulunamadı.");
    }
    const payload = await callSmmFull(
      { action: "refill_status", refill: providerRefillId },
      { retry: PROVIDER_CALL_POLICY.refillStatus.retry, action: "refill_status" },
    );
    const parsed = z
      .object({
        status: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
      })
      .safeParse(payload);
    if (!parsed.success || typeof parsed.data.status !== "string") {
      throw new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_refill_status_shape");
    }
    return { providerRefillId, status: sanitizeStatus(parsed.data.status) };
  }

  async requestCancel(providerOrderId: string): Promise<{ accepted: true }> {
    if (!/^\d{1,20}$/.test(providerOrderId)) {
      throw new AppError("INVALID_REQUEST", 400, "Bu sipariş iptal için uygun değil.");
    }
    const payload = await callSmmFull(
      { action: "cancel", orders: providerOrderId },
      { retry: PROVIDER_CALL_POLICY.cancel.retry, action: "cancel" },
    );
    const interpreted = interpretCancelPayload(payload, providerOrderId);
    if (interpreted.outcome === "accepted") return { accepted: true };
    if (interpreted.outcome === "rejected") {
      throw new AppError("PROVIDER_REJECTED", 502, "İptal talebi sağlayıcı tarafından reddedildi.", interpreted.code);
    }
    throw new AppError("PROVIDER_UNAVAILABLE", 503, "Hizmet sağlayıcısına ulaşılamadı.", "provider_cancel_shape");
  }

  private async loadServices(): Promise<ProviderService[]> {
    const payload = await callSmmFull(
      { action: "services" },
      { retry: PROVIDER_CALL_POLICY.services.retry, action: "services" },
    );
    const services = normalizeServices(payload);
    this.catalogCache = { expiresAt: Date.now() + SERVICE_CATALOG_CACHE_MS, services };
    return services;
  }
}

export const smmFullProvider = new SmmFullProvider();
