import { NextResponse } from "next/server";

import { establishSession } from "@/lib/auth/session";
import { signInWithPassword } from "@/lib/auth/identity-toolkit";
import { AUTH_BODY_MAX_BYTES, RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { readJson } from "@/lib/http/read-json";
import { loginSchema } from "@/lib/validation/auth";

export const POST = withApi(
  async (context) => {
    await enforceRateLimit({ route: "login", kind: "global" }, RATE_LIMITS.loginGlobal, {
      scope: "login_global",
      critical: true,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "login", kind: "ip", value: ip }, RATE_LIMITS.loginIp, {
        scope: "login_ip",
        critical: true,
      });
    }

    const body = loginSchema.parse(await readJson(context.request, AUTH_BODY_MAX_BYTES));
    await enforceRateLimit({ route: "login", kind: "email", value: body.email }, RATE_LIMITS.loginEmail, {
      scope: "login_email",
      critical: true,
    });

    const identity = await signInWithPassword(body.email, body.password);
    const user = await establishSession(identity.idToken);
    context.setUserId(user.uid);

    return NextResponse.json({ ok: true });
  },
  { mutation: true },
);
