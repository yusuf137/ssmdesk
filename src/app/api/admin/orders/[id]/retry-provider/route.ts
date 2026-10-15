import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { isOrderId } from "@/lib/orders/id";
import { submitPaidOrder } from "@/lib/provider/submit-order";

const retrySchema = z
  .object({
    confirmUnknown: z.boolean().optional(),
  })
  .strict();

type RetryContext = { params: Promise<{ id: string }> };

export function POST(request: Request, routeContext: RetryContext): Promise<NextResponse> {
  return withApi(
    async (context) => {
      const admin = await requireAdmin();
      context.setUserId(admin.uid);
      await enforceRateLimit({ route: "admin-retry-provider", kind: "user", value: admin.uid }, RATE_LIMITS.adminRetryUser, {
        scope: "admin_retry_user",
        critical: true,
      });
      const { id } = await routeContext.params;
      if (!isOrderId(id)) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
      const parsed = retrySchema.safeParse(await readJson(context.request, 1024));
      if (!parsed.success) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
      const status = await submitPaidOrder(id, { allowUnknownRetry: parsed.data.confirmUnknown === true });
      await writeAuditLog({
        action: "PROVIDER_ORDER_RETRY",
        requestId: context.requestId,
        endpoint: context.endpoint,
        outcome: status === "in_progress" ? "success" : "failure",
        userId: admin.uid,
        metadata: { orderId: id, confirmUnknown: parsed.data.confirmUnknown === true },
      });
      return NextResponse.json({ status });
    },
    { mutation: true },
  )(request);
}
