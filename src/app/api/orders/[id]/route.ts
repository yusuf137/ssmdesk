import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { createFirestoreOrderRepository } from "@/lib/orders/firestore-repository";
import { toPublicOrder } from "@/lib/orders/public-order";
import { readOrderCancelView } from "@/lib/cancel/firestore";
import { readOrderRefillView } from "@/lib/refill/firestore";

type OrderRouteContext = {
  params: Promise<{ id: string }>;
};

export function GET(request: Request, routeContext: OrderRouteContext): Promise<NextResponse> {
  return withApi(async (context) => {
    await enforceRateLimit({ route: "orders-read", kind: "global" }, RATE_LIMITS.orderReadGlobal, {
      scope: "orders_read_global",
      critical: true,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "orders-read", kind: "ip", value: ip }, RATE_LIMITS.orderReadIp, {
        scope: "orders_read_ip",
        critical: true,
      });
    }

    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "orders-read", kind: "user", value: user.uid }, RATE_LIMITS.orderStatusUser, {
      scope: "orders_read_user",
      critical: true,
    });

    const { id } = await routeContext.params;
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
    if (access.kind !== "own") {
      throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
    }
    const [refill, cancel] = await Promise.all([
      readOrderRefillView(user.uid, access.record).catch(() => ({ canRequest: false, history: [] })),
      readOrderCancelView(user.uid, access.record).catch(() => ({ canRequest: false, history: [] })),
    ]);
    return NextResponse.json({ order: toPublicOrder(access.record), refill, cancel });
  }, { mutation: false })(request);
}
