import { NextResponse } from "next/server";

import { readProviderMonitor } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-provider", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    const provider = await readProviderMonitor();
    await writeAuditLog({
      action: provider.level === "normal" || provider.level === null ? "PROVIDER_BALANCE_CHECKED" : "PROVIDER_BALANCE_LOW",
      requestId: context.requestId,
      endpoint: context.endpoint,
      outcome: provider.balanceMinor === null ? "failure" : "success",
      userId: admin.uid,
      metadata: { level: provider.level ?? "unknown" },
    });
    return NextResponse.json(provider);
  },
  { mutation: false },
);
