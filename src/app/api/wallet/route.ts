import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { publicWalletSchema } from "@/lib/wallet/public";
import { readWalletBalance } from "@/lib/wallet/firestore-read";

export const GET = withApi(
  async (context) => {
    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "wallet-read", kind: "user", value: user.uid }, RATE_LIMITS.walletReadUser, {
      scope: "wallet_read_user",
      critical: true,
    });
    const wallet = await readWalletBalance(user.uid);
    return NextResponse.json(publicWalletSchema.parse(wallet));
  },
  { mutation: false },
);
