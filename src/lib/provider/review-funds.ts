import "server-only";

import { COLLECTIONS } from "@/lib/constants";
import { getProviderLowBalanceThresholdMinor } from "@/lib/env/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/logging/audit";
import { parseOrder } from "@/lib/orders/firestore-repository";
import { providerBalanceLevel } from "@/lib/provider/money";
import { canReviewProviderFunds, decideProviderFunds } from "@/lib/provider/funds";
import { getSmmProvider } from "@/lib/smm";

export async function reviewOrderProviderFunds(
  orderId: string,
  source: "order" | "retry",
): Promise<"submitting" | "awaiting_provider_funds" | "skipped" | "unavailable"> {
  const database = getAdminFirestore();
  const orderRef = database.collection(COLLECTIONS.orders).doc(orderId);
  const privateRef = database.collection(COLLECTIONS.orderPrivate).doc(orderId);
  const now = new Date().toISOString();

  const claimed = await database.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const order = orderSnap.exists ? parseOrder(orderId, orderSnap.data()) : null;
    const privateSnap = await transaction.get(privateRef);
    const cost = privateSnap.get("providerCostMinor");
    if (!order || !canReviewProviderFunds(order.status)) return null;
    if (typeof cost !== "number" || !Number.isSafeInteger(cost) || cost < 0) return null;
    transaction.update(orderRef, { status: "checking_provider_balance", updatedAt: now });
    return { cost, userId: order.userId };
  });
  if (!claimed) return "skipped";

  let balanceMinor = 0;
  let currency: string | null = null;
  try {
    const balance = await getSmmProvider().getBalance();
    balanceMinor = balance.balanceMinor;
    currency = balance.currency;
  } catch {
    await writeAuditLog({
      action: "PROVIDER_BALANCE_CHECKED",
      requestId: "provider-balance",
      endpoint: "reviewOrderProviderFunds",
      outcome: "failure",
      userId: claimed.userId,
      metadata: { orderId, source },
    });
    return "unavailable";
  }

  const decision = decideProviderFunds({
    status: "checking_provider_balance",
    providerCostMinor: claimed.cost,
    providerBalanceMinor: balanceMinor,
  });
  if (!decision) return "unavailable";
  const threshold = getProviderLowBalanceThresholdMinor();
  const level = providerBalanceLevel(balanceMinor, threshold);

  await database.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const order = orderSnap.exists ? parseOrder(orderId, orderSnap.data()) : null;
    if (!order || order.status !== "checking_provider_balance") return;
    transaction.update(orderRef, { status: decision, updatedAt: new Date().toISOString() });
  });

  await writeAuditLog({
    action: "PROVIDER_BALANCE_CHECKED",
    requestId: "provider-balance",
    endpoint: "reviewOrderProviderFunds",
    outcome: "success",
    userId: claimed.userId,
    metadata: { orderId, source, balanceMinor, level, currency: currency ?? "" },
  });
  if (level !== "normal") {
    await writeAuditLog({
      action: "PROVIDER_BALANCE_LOW",
      requestId: "provider-balance",
      endpoint: "reviewOrderProviderFunds",
      outcome: "failure",
      userId: claimed.userId,
      metadata: { orderId, balanceMinor, level },
    });
  }
  if (decision === "awaiting_provider_funds") {
    await writeAuditLog({
      action: source === "retry" ? "PROVIDER_ORDER_RETRY" : "PROVIDER_ORDER_WAITING_FUNDS",
      requestId: "provider-balance",
      endpoint: "reviewOrderProviderFunds",
      outcome: "failure",
      userId: claimed.userId,
      metadata: { orderId, providerCostMinor: claimed.cost, balanceMinor },
    });
  } else if (source === "retry") {
    await writeAuditLog({
      action: "PROVIDER_ORDER_RETRY",
      requestId: "provider-balance",
      endpoint: "reviewOrderProviderFunds",
      outcome: "success",
      userId: claimed.userId,
      metadata: { orderId },
    });
  }
  return decision;
}

export async function retryAwaitingProviderOrder(orderId: string): Promise<"submitting" | "awaiting_provider_funds" | "skipped" | "unavailable"> {
  return reviewOrderProviderFunds(orderId, "retry");
}
