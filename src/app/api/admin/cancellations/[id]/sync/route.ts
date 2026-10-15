import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { syncCancelStatus } from "@/lib/cancel/firestore";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";

type SyncContext = { params: Promise<{ id: string }> };

export function POST(request: Request, routeContext: SyncContext): Promise<NextResponse> {
  return withApi(
    async (context) => {
      const admin = await requireAdmin();
      context.setUserId(admin.uid);
      await enforceRateLimit({ route: "admin-cancel-sync", kind: "user", value: admin.uid }, RATE_LIMITS.adminCancelSyncUser, {
        scope: "admin_cancel_sync_user",
        critical: true,
      });
      const { id } = await routeContext.params;
      const cancel = await syncCancelStatus(id, {
        force: true,
        requestId: context.requestId,
        endpoint: context.endpoint,
        actorId: admin.uid,
      });
      if (!cancel) throw new AppError("NOT_FOUND", 404, "İptal talebi bulunamadı.");
      return NextResponse.json({
        ok: true,
        cancellation: {
          id: cancel.id,
          orderId: cancel.orderId,
          userId: cancel.userId,
          providerOrderId: cancel.providerOrderId,
          status: cancel.status,
          createdAt: cancel.createdAt,
          lastCheckedAt: cancel.lastCheckedAt,
          internalErrorCode: cancel.internalErrorCode,
        },
      });
    },
    { mutation: true },
  )(request);
}