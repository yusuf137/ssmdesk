import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { readRefillForUser, syncRefillStatus } from "@/lib/refill/firestore";
import { toPublicRefill } from "@/lib/refill/policy";

type RefillRouteContext = { params: Promise<{ id: string }> };

export function GET(request: Request, routeContext: RefillRouteContext): Promise<NextResponse> {
  return withApi(async (context) => {
    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "refill-read", kind: "user", value: user.uid }, RATE_LIMITS.refillReadUser, {
      scope: "refill_read_user",
      critical: true,
    });
    const { id } = await routeContext.params;
    const owned = await readRefillForUser(id, user.uid);
    if (!owned) throw new AppError("NOT_FOUND", 404, "Refill talebi bulunamadı.");
    const synced = await syncRefillStatus(owned.id, {
      force: false,
      requestId: context.requestId,
      endpoint: context.endpoint,
      actorId: user.uid,
    });
    return NextResponse.json({ refill: toPublicRefill(synced ?? owned) });
  }, { mutation: false })(request);
}
