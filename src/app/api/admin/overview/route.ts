import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { readAdminOverview } from "@/lib/admin/queries";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { enforceRateLimit } from "@/lib/http/rate-limit";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-overview", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    return NextResponse.json(await readAdminOverview());
  },
  { mutation: false },
);
