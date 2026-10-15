import { NextResponse } from "next/server";

import { listUsers } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-users", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    const role = new URL(context.request.url).searchParams.get("role");
    if (role !== null && role !== "dealer") {
      throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    }
    return NextResponse.json({ users: await listUsers(role) });
  },
  { mutation: false },
);
