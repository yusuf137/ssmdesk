import { NextResponse } from "next/server";

import { listRecentAudit } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { enforceRateLimit } from "@/lib/http/rate-limit";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-audit", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    return NextResponse.json({ events: await listRecentAudit() });
  },
  { mutation: false },
);
