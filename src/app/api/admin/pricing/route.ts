import { NextResponse } from "next/server";

import { pricingUpdateSchema } from "@/lib/admin/schema";
import { requireAdmin } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { loadPricingSnapshot, savePricingUpdate } from "@/lib/pricing/firestore-config";

export const GET = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-pricing", kind: "user", value: admin.uid }, RATE_LIMITS.adminReadUser, {
      scope: "admin_read_user",
      critical: true,
    });
    const snapshot = await loadPricingSnapshot();
    return NextResponse.json({
      userMultiplier: snapshot.global.userMultiplier,
      dealerMultiplier: snapshot.global.dealerMultiplier,
      minimumProfitMinor: snapshot.global.minimumProfitMinor,
      categories: [...snapshot.categories.entries()].map(([category, value]) => ({ category, ...value })),
      overrides: [...snapshot.services.entries()]
        .filter(([, value]) => value.userFixedRateMinor || value.dealerFixedRateMinor || value.userMultiplier || value.dealerMultiplier)
        .map(([serviceId, value]) => ({
          serviceId,
          enabled: value.enabled,
          userFixedRateMinor: value.userFixedRateMinor,
          dealerFixedRateMinor: value.dealerFixedRateMinor,
          userMultiplier: value.userMultiplier,
          dealerMultiplier: value.dealerMultiplier,
        })),
    });
  },
  { mutation: false },
);

export const POST = withApi(
  async (context) => {
    const admin = await requireAdmin();
    context.setUserId(admin.uid);
    await enforceRateLimit({ route: "admin-pricing", kind: "user", value: admin.uid }, RATE_LIMITS.adminPricingUser, {
      scope: "admin_pricing_user",
      critical: true,
    });
    const parsed = pricingUpdateSchema.safeParse(await readJson(context.request, 4096));
    if (!parsed.success) throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    await savePricingUpdate(parsed.data);
    await writeAuditLog({
      action: "ADMIN_PRICING_UPDATED",
      requestId: context.requestId,
      endpoint: context.endpoint,
      outcome: "success",
      userId: admin.uid,
      metadata: { type: parsed.data.type },
    });
    return NextResponse.json({ ok: true });
  },
  { mutation: true },
);
