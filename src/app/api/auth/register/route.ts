import { NextResponse } from "next/server";

import { signUpWithPassword } from "@/lib/auth/identity-toolkit";
import { establishSession } from "@/lib/auth/session";
import { AUTH_BODY_MAX_BYTES, RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { readJson } from "@/lib/http/read-json";
import { registerSchema } from "@/lib/validation/auth";

export const POST = withApi(
  async (context) => {
    await enforceRateLimit({ route: "register", kind: "global" }, RATE_LIMITS.registerGlobal, {
      scope: "register_global",
      critical: true,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "register", kind: "ip", value: ip }, RATE_LIMITS.registerIp, {
        scope: "register_ip",
        critical: true,
      });
    }

    const body = registerSchema.parse(await readJson(context.request, AUTH_BODY_MAX_BYTES));
    await enforceRateLimit({ route: "register", kind: "email", value: body.email }, RATE_LIMITS.registerEmail, {
      scope: "register_email",
      critical: true,
    });

    const identity = await signUpWithPassword(body.email, body.password);
    const user = await establishSession(identity.idToken);
    context.setUserId(user.uid);

    return NextResponse.json({ ok: true });
  },
  { mutation: true },
);
