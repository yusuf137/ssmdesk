export const SESSION_COOKIE_NAME = "smm_session";
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_MS / 1000;

export const CSRF_HEADER = "x-requested-with";
export const CSRF_HEADER_VALUE = "smm-panel";
export const REQUEST_ID_HEADER = "x-request-id";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const AUTH_BODY_MAX_BYTES = 4_096;
export const AUTH_PROVIDER_TIMEOUT_MS = 10_000;

export const DEFAULT_SMMFULL_TIMEOUT_MS = 15_000;
export const MIN_SMMFULL_TIMEOUT_MS = 1_000;
export const MAX_SMMFULL_TIMEOUT_MS = 30_000;
export const DEFAULT_SMMFULL_API_URL = "https://smmfull.com/api/v2";
export const ALLOWED_PROVIDER_HOSTS = ["smmfull.com"] as const;
export const PROVIDER_MAX_RESPONSE_BYTES = 2_000_000;
export const PROVIDER_RETRY_DELAY_MS = 250;
export const SERVICE_CATALOG_CACHE_MS = 5 * 60 * 1000;
export const SERVICES_PAGE_SIZE = 50;
export const MAX_PROVIDER_SERVICES = 5_000;
export const MAX_ORDER_QUANTITY = 1_000_000_000;
export const MAX_TARGET_LENGTH = 2_048;

export const DEFAULT_SALE_PRICE_MULTIPLIER = 1.5;
export const MAX_SALE_PRICE_MULTIPLIER = 100;
export const DEFAULT_USER_PRICE_MULTIPLIER = 1.8;
export const DEFAULT_DEALER_PRICE_MULTIPLIER = 1.35;
export const MIN_ROLE_PRICE_MULTIPLIER = 1;
export const MAX_ROLE_PRICE_MULTIPLIER = 10;
export const DEFAULT_PROVIDER_LOW_BALANCE_MINOR = 50_000;
export const PRICE_SCALE = 10_000;

export const IDENTITY_TOOLKIT_ORIGIN = "https://identitytoolkit.googleapis.com";

export const COLLECTIONS = {
  users: "users",
  orders: "orders",
  orderPrivate: "orderPrivate",
  services: "services",
  auditLogs: "auditLogs",
  payments: "payments",
  wallets: "wallets",
  walletTransactions: "walletTransactions",
  pricingConfig: "pricingConfig",
  pricingOverrides: "pricingOverrides",
  refillRequests: "refillRequests",
  refillSlots: "refillSlots",
  cancelRequests: "cancelRequests",
  cancelSlots: "cancelSlots",
} as const;

export const ORDER_BODY_MAX_BYTES = 4_096;
export const ORDERS_PAGE_SIZE = 20;
export const ORDERS_LIST_CAP = 200;
export const WALLET_PAGE_SIZE = 20;
export const WALLET_LIST_CAP = 200;

export const RATE_LIMITS = {
  loginGlobal: { limit: 120, windowMs: 60_000 },
  loginIp: { limit: 30, windowMs: 15 * 60_000 },
  loginEmail: { limit: 8, windowMs: 15 * 60_000 },
  registerGlobal: { limit: 60, windowMs: 60 * 60_000 },
  registerIp: { limit: 20, windowMs: 60 * 60_000 },
  registerEmail: { limit: 5, windowMs: 60 * 60_000 },
  servicesGlobal: { limit: 300, windowMs: 60_000 },
  servicesUser: { limit: 30, windowMs: 60_000 },
  servicesIp: { limit: 60, windowMs: 60_000 },
  logoutGlobal: { limit: 60, windowMs: 60_000 },
  logoutIp: { limit: 30, windowMs: 15 * 60_000 },
  logoutUser: { limit: 30, windowMs: 60_000 },
  ordersGlobal: { limit: 30, windowMs: 60_000 },
  ordersIp: { limit: 20, windowMs: 60_000 },
  ordersUser: { limit: 10, windowMs: 60_000 },
  orderReadGlobal: { limit: 300, windowMs: 60_000 },
  orderReadIp: { limit: 120, windowMs: 60_000 },
  orderStatusUser: { limit: 60, windowMs: 60_000 },
  paymentInitGlobal: { limit: 30, windowMs: 60_000 },
  paymentInitIp: { limit: 10, windowMs: 60_000 },
  paymentInitUser: { limit: 5, windowMs: 60_000 },
  paymentCallbackGlobal: { limit: 120, windowMs: 60_000 },
  paymentCallbackIp: { limit: 60, windowMs: 60_000 },
  walletReadUser: { limit: 60, windowMs: 60_000 },
  walletProfileUser: { limit: 10, windowMs: 60_000 },
  adminReadUser: { limit: 60, windowMs: 60_000 },
  adminRoleUser: { limit: 10, windowMs: 60_000 },
  adminPricingUser: { limit: 10, windowMs: 60_000 },
  adminRetryUser: { limit: 10, windowMs: 60_000 },
  adminWalletUser: { limit: 10, windowMs: 60_000 },
  refillUser: { limit: 10, windowMs: 60 * 60_000 },
  refillIp: { limit: 20, windowMs: 60 * 60_000 },
  refillReadUser: { limit: 60, windowMs: 60_000 },
  adminRefillSyncUser: { limit: 10, windowMs: 60_000 },
  cancelUser: { limit: 10, windowMs: 60 * 60_000 },
  cancelIp: { limit: 20, windowMs: 60 * 60_000 },
  cancelReadUser: { limit: 60, windowMs: 60_000 },
  adminCancelSyncUser: { limit: 10, windowMs: 60_000 },
} as const;

export const PROVIDER_CALL_POLICY = {
  services: { retry: true },
  createOrder: { retry: false },
  orderStatus: { retry: true },
  balance: { retry: true },
  refill: { retry: false },
  refillStatus: { retry: false },
  cancel: { retry: false },
} as const;

export const REFILL_COOLDOWN_HOURS_DEFAULT = 24;
export const REFILL_STATUS_CACHE_MS = 60_000;
export const REFILL_HISTORY_CAP = 20;

export const TEXT_LIMITS = {
  serviceName: 200,
  category: 120,
  serviceType: 40,
  providerStatus: 32,
} as const;
