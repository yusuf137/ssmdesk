import "server-only";

import { AppError } from "@/lib/http/errors";
import type { PaytrConfig } from "@/lib/payments/paytr/types";

export type { PaytrConfig };

const UNAVAILABLE = "Ödeme hizmeti kullanılamıyor.";

export function getPaytrConfig(): PaytrConfig {
  const merchantId = required("PAYTR_MERCHANT_ID");
  const merchantKey = required("PAYTR_MERCHANT_KEY");
  const merchantSalt = required("PAYTR_MERCHANT_SALT");
  const testMode = flag("PAYTR_TEST_MODE");
  const noInstallment = bit("PAYTR_NO_INSTALLMENT");
  const maxInstallment = installment("PAYTR_MAX_INSTALLMENT");
  const timeoutLimit = timeout("PAYTR_TIMEOUT_LIMIT");
  const appBaseUrl = baseUrl("APP_BASE_URL");

  if (!/^[A-Za-z0-9]{1,32}$/.test(merchantId) || merchantKey.length < 8 || merchantSalt.length < 8) {
    throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
  }
  if (merchantKey.length > 256 || merchantSalt.length > 256) {
    throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
  }

  return {
    merchantId,
    merchantKey,
    merchantSalt,
    testMode,
    noInstallment,
    maxInstallment,
    timeoutLimit,
    appBaseUrl,
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "missing_paytr_config");
  return value;
}

function flag(name: string): "0" | "1" {
  const value = required(name).toLowerCase();
  if (value === "1" || value === "true") return "1";
  if (value === "0" || value === "false") return "0";
  throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
}

function bit(name: string): "0" | "1" {
  const value = required(name);
  if (value === "0" || value === "1") return value;
  throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
}

function installment(name: string): string {
  const value = required(name);
  if (!/^(0|[1-9]|1[0-2])$/.test(value)) {
    throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
  }
  return value;
}

function timeout(name: string): string {
  const value = required(name);
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(value) || parsed < 1 || parsed > 120) {
    throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
  }
  return value;
}

function baseUrl(name: string): string {
  const value = required(name).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.origin !== value || url.username || url.password || url.search || url.hash) {
    throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
  }
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new AppError("CONFIG_ERROR", 503, UNAVAILABLE, "invalid_paytr_config");
  }
  return url.origin;
}
