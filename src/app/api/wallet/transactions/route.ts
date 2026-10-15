import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/session";
import { RATE_LIMITS, WALLET_PAGE_SIZE } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { readOrderListQuery } from "@/lib/orders/query";
import { readWalletTransactions } from "@/lib/wallet/firestore-read";
import { publicLedgerPageSchema } from "@/lib/wallet/public";

export const GET = withApi(
  async (context) => {
    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "wallet-read", kind: "user", value: user.uid }, RATE_LIMITS.walletReadUser, {
      scope: "wallet_transactions_user",
      critical: true,
    });
    const page = readOrderListQuery(new URL(context.request.url));
    const listed = await readWalletTransactions(user.uid, page);
    return NextResponse.json(
      publicLedgerPageSchema.parse({
        transactions: listed.transactions,
        page: listed.page,
        pageSize: WALLET_PAGE_SIZE,
        total: listed.total,
        pageCount: listed.pageCount,
      }),
    );
  },
  { mutation: false },
);
