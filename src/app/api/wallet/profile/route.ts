import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { readBillingProfile, saveBillingProfile } from "@/lib/wallet/firestore-read";
import { billingProfileSchema, normalizeBillingProfile, publicBillingResponseSchema } from "@/lib/wallet/profile";

const BODY_LIMIT = 4_096;

export const GET = withApi(
  async (context) => {
    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "wallet-read", kind: "user", value: user.uid }, RATE_LIMITS.walletReadUser, {
      scope: "wallet_profile_read_user",
      critical: true,
    });
    const profile = await readBillingProfile(user.uid);
    return NextResponse.json(publicBillingResponseSchema.parse({ profile }));
  },
  { mutation: false },
);

export const POST = withApi(
  async (context) => {
    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "wallet-profile", kind: "user", value: user.uid }, RATE_LIMITS.walletProfileUser, {
      scope: "wallet_profile_user",
      critical: true,
    });
    const parsed = billingProfileSchema.parse(await readJson(context.request, BODY_LIMIT));
    const profile = normalizeBillingProfile(parsed);
    if (!profile) {
      throw new AppError("INVALID_REQUEST", 400, "Ad, telefon veya adres geçersiz.");
    }
    const saved = await saveBillingProfile({ userId: user.uid, email: user.email, profile });
    return NextResponse.json(publicBillingResponseSchema.parse({ profile: saved }));
  },
  { mutation: true },
);
