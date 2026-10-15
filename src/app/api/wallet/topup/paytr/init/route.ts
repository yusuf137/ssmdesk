import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { createFirestorePaymentRepository } from "@/lib/payments/firestore-repository";
import { getPaytrConfig } from "@/lib/payments/paytr/config";
import { initPaymentResponseSchema } from "@/lib/payments/schema";
import { readBillingProfile } from "@/lib/wallet/firestore-read";
import { topupInitSchema } from "@/lib/wallet/schema";
import { startWalletTopup } from "@/lib/wallet/topup";

const BODY_LIMIT = 4_096;

export const POST = withApi(
  async (context) => {
    await enforceRateLimit({ route: "payment-init", kind: "global" }, RATE_LIMITS.paymentInitGlobal, {
      scope: "wallet_topup_global",
      critical: true,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "payment-init", kind: "ip", value: ip }, RATE_LIMITS.paymentInitIp, {
        scope: "wallet_topup_ip",
        critical: true,
      });
    }

    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "payment-init", kind: "user", value: user.uid }, RATE_LIMITS.paymentInitUser, {
      scope: "wallet_topup_user",
      critical: true,
    });

    const body = topupInitSchema.parse(await readJson(context.request, BODY_LIMIT));
    const profile = await readBillingProfile(user.uid);
    const result = await startWalletTopup({
      user,
      ...body,
      profile,
      userIp: ip,
      config: getPaytrConfig(),
      payments: createFirestorePaymentRepository(),
    });

    await writeAuditLog({
      action: "WALLET_TOPUP_INITIATED",
      requestId: context.requestId,
      endpoint: context.endpoint,
      outcome: "success",
      userId: user.uid,
      metadata: {
        ...("packageId" in body ? { packageId: body.packageId } : {}),
        merchantOid: result.merchantOid,
        amountMinor: result.amountMinor,
      },
    });

    return NextResponse.json(initPaymentResponseSchema.parse({ token: result.token, iframeUrl: result.iframeUrl }));
  },
  { mutation: true },
);
