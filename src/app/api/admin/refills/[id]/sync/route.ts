import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { syncRefillStatus } from "@/lib/refill/firestore";

type SyncContext = { params: Promise<{ id: string }> };

export function POST(request: Request, routeContext: SyncContext): Promise<NextResponse> {
  return withApi(
    async (context) => {
      const admin = await requireAdmin();
      context.setUserId(admin.uid);
      await enforceRateLimit({ route: "admin-refill-sync", kind: "user", value: admin.uid }, RATE_LIMITS.adminRefillSyncUser, {
        scope: "admin_refill_sync_user",
        critical: true,
      });
      const { id } = await routeContext.params;
      const refill = await syncRefillStatus(id, {
        force: true,
        requestId: context.requestId,
        endpoint: context.endpoint,
        actorId: admin.uid,
      });
      if (!refill) throw new AppError("NOT_FOUND", 404, "Refill talebi bulunamadı.");
      return NextResponse.json({
        ok: true,
        refill: {
          id: refill.id,
          orderId: refill.orderId,
          userId: refill.userId,
          providerOrderId: refill.providerOrderId,
          providerRefillId: refill.providerRefillId,
          status: refill.status,
          createdAt: refill.createdAt,
          lastCheckedAt: refill.lastCheckedAt,
          internalErrorCode: refill.internalErrorCode,
        },
      });
    },
    { mutation: true },
  )(request);
}
