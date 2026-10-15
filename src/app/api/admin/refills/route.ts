import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { listAdminRefills } from "@/lib/refill/firestore";
import { isAdminRefillFilter } from "@/lib/refill/policy";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-refills", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    const status = new URL(context.request.url).searchParams.get("status") ?? "processing";
    if (!isAdminRefillFilter(status)) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    return NextResponse.json({ refills: await listAdminRefills(status) });
  },
  { mutation: false },
);
