import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { RATE_LIMITS, REQUEST_ID_HEADER } from "@/lib/constants";
import { getClientIp } from "@/lib/http/client-ip";
import { RateLimitStoreError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { resolveRequestId } from "@/lib/http/request-id";
import { writeAuditLog } from "@/lib/logging/audit";
import { logWarn } from "@/lib/logging/logger";
import { handlePaytrCallback } from "@/lib/payments/handle-callback";
import { createFirestorePaymentRepository } from "@/lib/payments/firestore-repository";
import { getPaytrConfig } from "@/lib/payments/paytr/config";

export async function POST(request: Request): Promise<Response> {
  await connection();
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const endpoint = "/api/payments/paytr/callback";

  try {
    await enforceRateLimit({ route: "payment-callback", kind: "global" }, RATE_LIMITS.paymentCallbackGlobal, {
      scope: "payment_callback_global",
      critical: true,
    });
    const ip = getClientIp(request);
    if (ip) {
      await enforceRateLimit({ route: "payment-callback", kind: "ip", value: ip }, RATE_LIMITS.paymentCallbackIp, {
        scope: "payment_callback_ip",
        critical: true,
      });
    }

    const fields = await readCallbackFields(request);
    const merchantOid = /^[a-z0-9]{8,64}$/.test(fields.merchant_oid ?? "") ? fields.merchant_oid : undefined;
    await writeAuditLog({
      action: "PAYMENT_CALLBACK_RECEIVED",
      requestId,
      endpoint,
      outcome: "success",
      metadata: merchantOid ? { merchantOid } : {},
    });

    const result = await handlePaytrCallback({
      fields,
      config: getPaytrConfig(),
      payments: createFirestorePaymentRepository(),
    });

    await writeAuditLog({
      action: result.event,
      requestId,
      endpoint,
      outcome: result.response === "OK" ? "success" : "failure",
      metadata: {
        ...(merchantOid ? { merchantOid } : {}),
        ...(result.orderId ? { orderId: result.orderId } : {}),
      },
    });

    return text(result.response === "OK" ? "OK" : "INVALID", result.response === "OK" ? 200 : 400, requestId);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof RateLimitStoreError) {
      logWarn("RATE_LIMIT_STORE_ERROR", { requestId, endpoint, scope: error.scope, fallback: false });
    } else {
      logWarn("api_error", { requestId, endpoint, code: "callback_failed" });
    }
    return text("UNAVAILABLE", 503, requestId);
  }
}

function text(body: "OK" | "INVALID" | "UNAVAILABLE", status: number, requestId: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

async function readCallbackFields(request: Request): Promise<Record<string, string>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 16_384) return {};
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded") && !type.includes("multipart/form-data")) return {};
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" || !/^[a-z_]{1,40}$/.test(key)) continue;
    fields[key] = value.slice(0, 512);
  }
  return fields;
}
