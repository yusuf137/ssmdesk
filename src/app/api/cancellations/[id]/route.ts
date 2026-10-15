import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { readCancelForUser, syncCancelStatus } from "@/lib/cancel/firestore";
import { toPublicCancel } from "@/lib/cancel/policy";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";

type CancelRouteContext = { params: Promise<{ id: string }> };

export function GET(request: Request, routeContext: CancelRouteContext): Promise<NextResponse> {
  return withApi(async (context) => {
    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "cancel-read", kind: "user", value: user.uid }, RATE_LIMITS.cancelReadUser, {
      scope: "cancel_read_user",
      critical: true,
    });
    const { id } = await routeContext.params;
    const owned = await readCancelForUser(id, user.uid);
    if (!owned) throw new AppError("NOT_FOUND", 404, "İptal talebi bulunamadı.");
    const synced = await syncCancelStatus(owned.id, {
      force: false,
      requestId: context.requestId,
      endpoint: context.endpoint,
      actorId: user.uid,
    });
    return NextResponse.json({ cancel: toPublicCancel(synced ?? owned) });
  }, { mutation: false })(request);
}
