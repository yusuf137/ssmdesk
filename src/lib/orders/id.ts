import { createHash } from "node:crypto";

export function isViewerId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[\x21-\x7E]+$/.test(value);
}

export function orderDocumentId(userId: string, idempotencyKey: string): string {
  return createHash("sha256").update(`${userId}:${idempotencyKey}`, "utf8").digest("hex");
}

export function isOrderId(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
