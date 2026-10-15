import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { listAdminCancels } from "@/lib/cancel/firestore";
import { isAdminCancelFilter } from "@/lib/cancel/policy";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-cancellations", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    const status = new URL(context.request.url).searchParams.get("status") ?? "processing";
    if (!isAdminCancelFilter(status)) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    return NextResponse.json({ cancellations: await listAdminCancels(status) });
  },
  { mutation: false },
);
