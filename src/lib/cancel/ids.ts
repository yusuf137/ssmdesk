import { createHash } from "node:crypto";

export function cancelRefundLedgerId(orderId: string, referenceId: string): string {
  const digest = createHash("sha256").update(`${orderId}:${referenceId}`, "utf8").digest("hex").slice(0, 40);
  return `cxrefund_${digest}`;
}
