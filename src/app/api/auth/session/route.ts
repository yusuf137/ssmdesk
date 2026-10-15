import { NextResponse } from "next/server";

import { clearSession, readAuthenticatedUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { enforceRateLimit } from "@/lib/http/rate-limit";

export const DELETE = withApi(
  async (context) => {
    await enforceRateLimit({ route: "session", kind: "global" }, RATE_LIMITS.logoutGlobal, {
      scope: "session_global",
      critical: true,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "session", kind: "ip", value: ip }, RATE_LIMITS.logoutIp, {
        scope: "session_ip",
        critical: true,
      });
    }
    const user = await readAuthenticatedUser().catch(() => null);
    if (user) {
      context.setUserId(user.uid);
      await enforceRateLimit({ route: "session", kind: "user", value: user.uid }, RATE_LIMITS.logoutUser, {
        scope: "session_user",
        critical: true,
      });
    }
    await clearSession();
    return NextResponse.json({ ok: true });
  },
  { mutation: true },
);
