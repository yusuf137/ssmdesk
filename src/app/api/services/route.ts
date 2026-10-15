import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { getPublicCatalog } from "@/lib/services/catalog";
import { toPublicService } from "@/lib/services/public-service";

export const GET = withApi(
  async (context) => {
    await enforceRateLimit({ route: "services", kind: "global" }, RATE_LIMITS.servicesGlobal, {
      scope: "services_global",
      critical: false,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "services", kind: "ip", value: ip }, RATE_LIMITS.servicesIp, {
        scope: "services_ip",
        critical: false,
      });
    }

    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "services", kind: "user", value: user.uid }, RATE_LIMITS.servicesUser, {
      scope: "services_user",
      critical: false,
    });
    const url = new URL(context.request.url);
    if (url.searchParams.has("role") || url.searchParams.has("userId") || url.searchParams.has("multiplier")) {
      throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    }

    const services = (await getPublicCatalog(user.role)).map((service) => {
      const type = typeof service.type === "string" && service.type.trim() ? service.type.trim() : "Standart";
      return {
        ...toPublicService({ ...service, type }),
        type,
      };
    });
    return NextResponse.json({ services });
  },
  { mutation: false },
);
