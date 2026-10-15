import "server-only";

import { AppError } from "@/lib/http/errors";
import {
  ALLOWED_PROVIDER_HOSTS,
  DEFAULT_SMMFULL_API_URL,
  DEFAULT_SMMFULL_TIMEOUT_MS,
  DEFAULT_DEALER_PRICE_MULTIPLIER,
  DEFAULT_PROVIDER_LOW_BALANCE_MINOR,
  DEFAULT_SALE_PRICE_MULTIPLIER,
  DEFAULT_USER_PRICE_MULTIPLIER,
  MAX_ROLE_PRICE_MULTIPLIER,
  MAX_SALE_PRICE_MULTIPLIER,
  MIN_ROLE_PRICE_MULTIPLIER,
  MAX_SMMFULL_TIMEOUT_MS,
  MIN_SMMFULL_TIMEOUT_MS,
} from "@/lib/constants";

function missing(name: string, publicMessage: string): AppError {
  return new AppError("CONFIG_ERROR", 503, publicMessage, `Missing ${name}`);
}

function invalid(name: string, publicMessage: string): AppError {
  return new AppError("CONFIG_ERROR", 503, publicMessage, `Invalid ${name}`);
}

function requireText(name: string, publicMessage: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw missing(name, publicMessage);
  return value;
}

export type SmmConfig = {
  apiKey: string;
  apiUrl: string;
  timeoutMs: number;
};

const CATALOG_UNAVAILABLE = "Hizmet listesi alınamadı.";
const AUTH_UNAVAILABLE = "Kimlik doğrulama hizmeti kullanılamıyor.";

export function getSmmConfig(): SmmConfig {
  const apiKey = requireText("SMMFULL_API_KEY", CATALOG_UNAVAILABLE);
  const apiUrl = assertProviderUrl(
    process.env.SMMFULL_API_URL?.trim() || DEFAULT_SMMFULL_API_URL,
  );
  return {
    apiKey,
    apiUrl,
    timeoutMs: readBoundedNumber(
      "SMMFULL_TIMEOUT_MS",
      DEFAULT_SMMFULL_TIMEOUT_MS,
      MIN_SMMFULL_TIMEOUT_MS,
      MAX_SMMFULL_TIMEOUT_MS,
      CATALOG_UNAVAILABLE,
    ),
  };
}

export function getSalePriceMultiplier(): number {
  return readBoundedNumber(
    "SALE_PRICE_MULTIPLIER",
    DEFAULT_SALE_PRICE_MULTIPLIER,
    Number.MIN_VALUE,
    MAX_SALE_PRICE_MULTIPLIER,
    CATALOG_UNAVAILABLE,
  );
}

export function getUserPriceMultiplier(): number {
  return readBoundedNumber(
    "USER_PRICE_MULTIPLIER",
    DEFAULT_USER_PRICE_MULTIPLIER,
    MIN_ROLE_PRICE_MULTIPLIER,
    MAX_ROLE_PRICE_MULTIPLIER,
    CATALOG_UNAVAILABLE,
  );
}

export function getDealerPriceMultiplier(): number {
  return readBoundedNumber(
    "DEALER_PRICE_MULTIPLIER",
    DEFAULT_DEALER_PRICE_MULTIPLIER,
    MIN_ROLE_PRICE_MULTIPLIER,
    MAX_ROLE_PRICE_MULTIPLIER,
    CATALOG_UNAVAILABLE,
  );
}

export function getProviderLowBalanceThresholdMinor(): number {
  const value = readBoundedNumber(
    "PROVIDER_LOW_BALANCE_THRESHOLD_MINOR",
    DEFAULT_PROVIDER_LOW_BALANCE_MINOR,
    0,
    1_000_000_000,
    "Sağlayıcı bakiyesi alınamadı.",
  );
  if (!Number.isSafeInteger(value)) {
    throw invalid("PROVIDER_LOW_BALANCE_THRESHOLD_MINOR", "Sağlayıcı bakiyesi alınamadı.");
  }
  return value;
}

export type FirebaseAdminConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function getFirebaseAdminConfig(): FirebaseAdminConfig {
  const projectId = requireText("FIREBASE_PROJECT_ID", AUTH_UNAVAILABLE);
  const clientEmail = requireText("FIREBASE_CLIENT_EMAIL", AUTH_UNAVAILABLE);
  const privateKey = requireText("FIREBASE_PRIVATE_KEY", AUTH_UNAVAILABLE).replace(
    /\\n/g,
    "\n",
  );

  if (!privateKey.includes("BEGIN PRIVATE KEY") || !clientEmail.includes("@")) {
    throw invalid("FIREBASE_ADMIN", AUTH_UNAVAILABLE);
  }

  return { projectId, clientEmail, privateKey };
}

export function getFirebaseWebApiKey(): string {
  return requireText("FIREBASE_WEB_API_KEY", AUTH_UNAVAILABLE);
}

function readBoundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
  publicMessage: string,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw invalid(name, publicMessage);
  }
  return value;
}

function assertProviderUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid("SMMFULL_API_URL", CATALOG_UNAVAILABLE);
  }

  const hostAllowed = ALLOWED_PROVIDER_HOSTS.some((host) => host === url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostAllowed
  ) {
    throw invalid("SMMFULL_API_URL", CATALOG_UNAVAILABLE);
  }

  return url.toString();
}
