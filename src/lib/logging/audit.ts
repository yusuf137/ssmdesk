import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/constants";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";
import { logWarn } from "@/lib/logging/logger";
import { redact } from "@/lib/logging/redact";

export type AuditAction =
  | "authentication_failed"
  | "authorization_failed"
  | "rate_limit_exceeded"
  | "RATE_LIMIT_HIT"
  | "RATE_LIMIT_STORE_ERROR"
  | "order_created"
  | "ORDER_CREATED"
  | "ORDER_IDEMPOTENCY_HIT"
  | "ORDER_VALIDATION_FAILED"
  | "ORDER_UNAUTHORIZED_ACCESS"
  | "ORDER_REJECTED"
  | "PAYMENT_INITIATED"
  | "PAYMENT_CALLBACK_RECEIVED"
  | "PAYMENT_CALLBACK_INVALID_HASH"
  | "PAYMENT_AMOUNT_MISMATCH"
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_CALLBACK_DUPLICATE"
  | "PAYMENT_CALLBACK_REJECTED"
  | "WALLET_TOPUP_INITIATED"
  | "WALLET_TOPUP_SUCCEEDED"
  | "WALLET_TOPUP_DUPLICATE"
  | "WALLET_TOPUP_FAILED"
  | "WALLET_ORDER_DEBIT"
  | "WALLET_INSUFFICIENT_BALANCE"
  | "WALLET_REFUND"
  | "ADMIN_ROLE_CHANGED"
  | "ADMIN_WALLET_ADJUSTED"
  | "ADMIN_PRICING_UPDATED"
  | "PROVIDER_BALANCE_CHECKED"
  | "PROVIDER_BALANCE_LOW"
  | "PROVIDER_ORDER_RETRY"
  | "PROVIDER_ORDER_WAITING_FUNDS"
  | "PROVIDER_ORDER_SUBMIT_STARTED"
  | "PROVIDER_ORDER_SUBMITTED"
  | "PROVIDER_ORDER_REJECTED"
  | "PROVIDER_ORDER_UNKNOWN"
  | "PROVIDER_ORDER_REFUNDED"
  | "PROVIDER_CURRENCY_MISMATCH"
  | "REFILL_REQUESTED"
  | "REFILL_SUBMIT_STARTED"
  | "REFILL_SUBMITTED"
  | "REFILL_REJECTED"
  | "REFILL_UNKNOWN"
  | "REFILL_STATUS_SYNCED"
  | "REFILL_COMPLETED"
  | "REFILL_DUPLICATE_BLOCKED"
  | "CANCEL_REQUESTED"
  | "CANCEL_SUBMITTED"
  | "CANCEL_REJECTED"
  | "CANCEL_UNKNOWN"
  | "CANCEL_STATUS_SYNCED"
  | "CANCEL_SETTLEMENT_STARTED"
  | "CANCEL_REFUND_APPLIED"
  | "CANCEL_COMPLETED"
  | "CANCEL_DUPLICATE_BLOCKED"
  | "order_status_requested"
  | "admin_action";

type AuditMetadata = Record<string, string | number | boolean>;

export async function writeAuditLog(entry: {
  action: AuditAction;
  requestId: string;
  endpoint: string;
  outcome: "success" | "failure";
  userId?: string;
  metadata?: AuditMetadata;
}): Promise<void> {
  const metadata = sanitizeMetadata(entry.metadata ?? {});
  try {
    await getAdminFirestore()
      .collection(COLLECTIONS.auditLogs)
      .add({
        action: entry.action,
        requestId: entry.requestId,
        endpoint: entry.endpoint,
        outcome: entry.outcome,
        userId: entry.userId ?? null,
        metadata,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logWarn("audit_log_failed", {
      requestId: entry.requestId,
      endpoint: entry.endpoint,
      action: entry.action,
      code: error instanceof AppError ? error.code : "audit_write_failed",
    });
  }
}

function sanitizeMetadata(metadata: AuditMetadata): AuditMetadata {
  const redacted = redact(metadata);
  if (typeof redacted !== "object" || redacted === null || Array.isArray(redacted)) return {};

  const safe: AuditMetadata = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 200);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean") safe[key] = value;
  }
  return safe;
}
