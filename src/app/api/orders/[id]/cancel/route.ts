import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { requestOrderCancel } from "@/lib/cancel/firestore";
import { cancelRequestSchema } from "@/lib/cancel/policy";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { createFirestoreOrderRepository } from "@/lib/orders/firestore-repository";
import { isOrderId } from "@/lib/orders/id";

type CancelRouteContext = { params: Promise<{ id: string }> };

async function assertEmptyCancelBody(request: Request): Promise<void> {
  const contentType = request.headers.get("content-type");
  if (!contentType) return;
  const body = await readJson(request, 512);
  if (!cancelRequestSchema.safeParse(body).success) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
}

export function POST(request: Request, routeContext: CancelRouteContext): Promise<NextResponse> {
  return withApi(
    async (context) => {
      await enforceRateLimit({ route: "cancel-create", kind: "global" }, RATE_LIMITS.ordersGlobal, {
        scope: "cancel_create_global",
        critical: true,
      });
      const ip = getClientIp(context.request);
      if (ip) {
        await enforceRateLimit({ route: "cancel-create", kind: "ip", value: ip }, RATE_LIMITS.cancelIp, {
          scope: "cancel_create_ip",
          critical: true,
        });
      }
      const user = await requireApiUser();
      context.setUserId(user.uid);
      await enforceRateLimit({ route: "cancel-create", kind: "user", value: user.uid }, RATE_LIMITS.cancelUser, {
        scope: "cancel_create_user",
        critical: true,
      });
      const { id } = await routeContext.params;
      if (!isOrderId(id)) throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
      await assertEmptyCancelBody(context.request);
      const access = await createFirestoreOrderRepository().accessForUser(id, user.uid);
      if (access.kind === "foreign") {
        await writeAuditLog({
          action: "ORDER_UNAUTHORIZED_ACCESS",
          requestId: context.requestId,
          endpoint: context.endpoint,
          outcome: "failure",
          userId: user.uid,
          metadata: { orderId: id },
        });
        throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
      }
      if (access.kind !== "own") throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
      const result = await requestOrderCancel({
        userId: user.uid,
        orderId: id,
        requestId: context.requestId,
        endpoint: context.endpoint,
      });
      const message = result.duplicate
        ? "Bu sipariş için açık bir iptal talebi var."
        : result.cancel.status === "rejected"
          ? "İptal talebi sağlayıcı tarafından reddedildi."
          : "İptal talebiniz alındı.";
      return NextResponse.json({ ok: true, duplicate: result.duplicate, cancel: result.cancel, message });
    },
    { mutation: true },
  )(request);
}
