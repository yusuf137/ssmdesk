import { NextResponse } from "next/server";

import { listAdminOrders } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { isAdminOrderFilter } from "@/lib/provider/submission";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-orders", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    const status = new URL(context.request.url).searchParams.get("status") ?? "awaiting_provider_funds";
    if (!isAdminOrderFilter(status)) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    return NextResponse.json({ orders: await listAdminOrders(status) });
  },
  { mutation: false },
);
