import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { createFirestoreOrderRepository } from "@/lib/orders/firestore-repository";
import { isOrderId } from "@/lib/orders/id";
import { refillRequestSchema } from "@/lib/refill/policy";
import { requestOrderRefill } from "@/lib/refill/firestore";

type RefillRouteContext = { params: Promise<{ id: string }> };

async function assertEmptyRefillBody(request: Request): Promise<void> {
  const contentType = request.headers.get("content-type");
  if (!contentType) return;
  const body = await readJson(request, 512);
  if (!refillRequestSchema.safeParse(body).success) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
}

export function POST(request: Request, routeContext: RefillRouteContext): Promise<NextResponse> {
  return withApi(
    async (context) => {
      await enforceRateLimit({ route: "refill-create", kind: "global" }, RATE_LIMITS.ordersGlobal, {
        scope: "refill_create_global",
        critical: true,
      });
      const ip = getClientIp(context.request);
      if (ip) {
        await enforceRateLimit({ route: "refill-create", kind: "ip", value: ip }, RATE_LIMITS.refillIp, {
          scope: "refill_create_ip",
          critical: true,
        });
      }
      const user = await requireApiUser();
      context.setUserId(user.uid);
      await enforceRateLimit({ route: "refill-create", kind: "user", value: user.uid }, RATE_LIMITS.refillUser, {
        scope: "refill_create_user",
        critical: true,
      });
      const { id } = await routeContext.params;
      if (!isOrderId(id)) throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
      await assertEmptyRefillBody(context.request);
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
      const result = await requestOrderRefill({
        userId: user.uid,
        orderId: id,
        requestId: context.requestId,
        endpoint: context.endpoint,
      });
      return NextResponse.json({
        ok: true,
        duplicate: result.duplicate,
        refill: result.refill,
        message: result.duplicate
          ? "Bu sipariş için açık bir refill talebi var."
          : result.refill.status === "rejected"
            ? "Refill talebi sağlayıcı tarafından reddedildi."
            : "Refill talebiniz alındı.",
      });
    },
    { mutation: true },
  )(request);
}
