import { NextResponse } from "next/server";

import { assignRoleSchema } from "@/lib/admin/schema";
import { requireAdmin } from "@/lib/auth/session";
import { setAssignableUserRole } from "@/lib/auth/user-store";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { isViewerId } from "@/lib/orders/id";

type RoleContext = { params: Promise<{ uid: string }> };

export function POST(request: Request, routeContext: RoleContext): Promise<NextResponse> {
  return withApi(
    async (context) => {
      const admin = await requireAdmin();
      context.setUserId(admin.uid);
      await enforceRateLimit({ route: "admin-role", kind: "user", value: admin.uid }, RATE_LIMITS.adminRoleUser, {
        scope: "admin_role_user",
        critical: true,
      });
      const { uid } = await routeContext.params;
      if (!isViewerId(uid)) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
      const parsed = assignRoleSchema.safeParse(await readJson(context.request, 1024));
      if (!parsed.success) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
      await setAssignableUserRole({ actorId: admin.uid, targetId: uid, role: parsed.data.role });
      await writeAuditLog({
        action: "ADMIN_ROLE_CHANGED",
        requestId: context.requestId,
        endpoint: context.endpoint,
        outcome: "success",
        userId: admin.uid,
        metadata: { targetId: uid, role: parsed.data.role },
      });
      return NextResponse.json({ ok: true });
    },
    { mutation: true },
  )(request);
}
