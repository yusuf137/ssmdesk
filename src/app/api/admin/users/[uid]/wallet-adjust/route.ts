import { NextResponse } from "next/server";

import { walletAdjustSchema } from "@/lib/admin/schema";
import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { isViewerId } from "@/lib/orders/id";
import { adjustWalletBalance } from "@/lib/wallet/firestore-adjust";

type AdjustContext = { params: Promise<{ uid: string }> };

export function POST(request: Request, routeContext: AdjustContext): Promise<NextResponse> {
  return withApi(
    async (context) => {
      const admin = await requireAdmin();
      context.setUserId(admin.uid);
      await enforceRateLimit({ route: "admin-wallet", kind: "user", value: admin.uid }, RATE_LIMITS.adminWalletUser, {
        scope: "admin_wallet_user",
        critical: true,
      });
      const { uid } = await routeContext.params;
      if (!isViewerId(uid)) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
      const parsed = walletAdjustSchema.safeParse(await readJson(context.request, 2048));
      if (!parsed.success) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
      const result = await adjustWalletBalance({
        targetUserId: uid,
        amountMinor: parsed.data.amountMinor,
        reason: parsed.data.reason,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      await writeAuditLog({
        action: "ADMIN_WALLET_ADJUSTED",
        requestId: context.requestId,
        endpoint: context.endpoint,
        outcome: "success",
        userId: admin.uid,
        metadata: {
          targetId: uid,
          amountMinor: parsed.data.amountMinor,
          duplicate: result.duplicate,
        },
      });
      return NextResponse.json({
        ok: true,
        duplicate: result.duplicate,
        balanceMinor: result.balanceMinor,
      });
    },
    { mutation: true },
  )(request);
}
