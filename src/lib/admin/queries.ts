import "server-only";

import { COLLECTIONS } from "@/lib/constants";
import { getProviderLowBalanceThresholdMinor } from "@/lib/env/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { parseOrder } from "@/lib/orders/firestore-repository";
import { isAdminOrderFilter, type AdminOrderFilter } from "@/lib/provider/submission";
import { providerBalanceLevel, type ProviderBalanceLevel } from "@/lib/provider/money";
import { getSmmProvider } from "@/lib/smm";

const PENDING_STATUSES = ["paid", "checking_provider_balance", "submitting"] as const;

function timestampToIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return typeof value === "string" ? value : null;
}

export async function readAdminOverview(): Promise<{
  userCount: number;
  dealerCount: number;
  pendingCount: number;
  awaitingCount: number;
  provider: {
    balanceMinor: number | null;
    currency: string | null;
    thresholdMinor: number;
    level: ProviderBalanceLevel | null;
    estimatedCostMinor: number;
    truncated: boolean;
  };
}> {
  const database = getAdminFirestore();
  const [users, dealers, pending, awaiting] = await Promise.all([
    database.collection(COLLECTIONS.users).count().get(),
    database.collection(COLLECTIONS.users).where("role", "==", "dealer").count().get(),
    database.collection(COLLECTIONS.orders).where("status", "in", [...PENDING_STATUSES]).count().get(),
    database.collection(COLLECTIONS.orders).where("status", "==", "awaiting_provider_funds").count().get(),
  ]);
  const provider = await readProviderMonitor();
  return {
    userCount: users.data().count,
    dealerCount: dealers.data().count,
    pendingCount: pending.data().count,
    awaitingCount: awaiting.data().count,
    provider,
  };
}

export async function readProviderMonitor(): Promise<{
  balanceMinor: number | null;
  currency: string | null;
  thresholdMinor: number;
  level: ProviderBalanceLevel | null;
  estimatedCostMinor: number;
  truncated: boolean;
}> {
  const thresholdMinor = getProviderLowBalanceThresholdMinor();
  let balanceMinor: number | null = null;
  let currency: string | null = null;
  let level: ProviderBalanceLevel | null = null;
  try {
    const balance = await getSmmProvider().getBalance();
    balanceMinor = balance.balanceMinor;
    currency = balance.currency;
    level = providerBalanceLevel(balanceMinor, thresholdMinor);
  } catch {
    balanceMinor = null;
  }
  const estimate = await sumAwaitingProviderCost();
  return { balanceMinor, currency, thresholdMinor, level, ...estimate };
}

async function sumAwaitingProviderCost(): Promise<{ estimatedCostMinor: number; truncated: boolean }> {
  const database = getAdminFirestore();
  const waiting = await database
    .collection(COLLECTIONS.orders)
    .where("status", "==", "awaiting_provider_funds")
    .limit(51)
    .get();
  const ids = waiting.docs.slice(0, 50).map((document) => document.id);
  if (ids.length === 0) return { estimatedCostMinor: 0, truncated: false };
  const refs = ids.map((id) => database.collection(COLLECTIONS.orderPrivate).doc(id));
  const snaps = await database.getAll(...refs);
  let estimatedCostMinor = 0;
  for (const snap of snaps) {
    const cost = snap.get("providerCostMinor");
    if (typeof cost === "number" && Number.isSafeInteger(cost) && cost > 0) estimatedCostMinor += cost;
  }
  return { estimatedCostMinor, truncated: waiting.size > 50 };
}

export async function listAdminOrders(status: AdminOrderFilter): Promise<
  Array<{
    id: string;
    userId: string;
    email: string | null;
    serviceId: number;
    serviceName: string;
    status: AdminOrderFilter;
    salePriceMinor: number;
    supplierMinor: number | null;
    marginMinor: number | null;
    supplierCurrency: string | null;
    supplierOrderId: string | null;
    submissionErrorCode: string | null;
    attempts: number;
    createdAt: string;
  }>
> {
  if (!isAdminOrderFilter(status)) return [];
  const database = getAdminFirestore();
  const waiting = await database.collection(COLLECTIONS.orders).where("status", "==", status).limit(50).get();
  const orders = waiting.docs.flatMap((document) => {
    const order = parseOrder(document.id, document.data());
    return order ? [order] : [];
  });
  const privateRefs = orders.map((order) => database.collection(COLLECTIONS.orderPrivate).doc(order.id));
  const userRefs = [...new Set(orders.map((order) => order.userId))].map((uid) =>
    database.collection(COLLECTIONS.users).doc(uid),
  );
  const [privateSnaps, userSnaps] = await Promise.all([
    privateRefs.length > 0 ? database.getAll(...privateRefs) : Promise.resolve([]),
    userRefs.length > 0 ? database.getAll(...userRefs) : Promise.resolve([]),
  ]);
  const privateRows = new Map<
    string,
    {
      supplierMinor: number | null;
      marginMinor: number | null;
      supplierCurrency: string | null;
      supplierOrderId: string | null;
      submissionErrorCode: string | null;
      attempts: number;
    }
  >();
  for (const snap of privateSnaps) {
    const cost = snap.get("providerCostMinor");
    const margin = snap.get("grossMarginMinor");
    const supplierOrderId = snap.get("providerOrderId");
    const currency = snap.get("providerCurrency");
    const errorCode = snap.get("submissionErrorCode");
    const attempts = snap.get("submissionAttemptCount");
    privateRows.set(snap.id, {
      supplierMinor: typeof cost === "number" && Number.isSafeInteger(cost) ? cost : null,
      marginMinor: typeof margin === "number" && Number.isSafeInteger(margin) ? margin : null,
      supplierCurrency: typeof currency === "string" ? currency : null,
      supplierOrderId: typeof supplierOrderId === "string" && /^\d{1,20}$/.test(supplierOrderId) ? supplierOrderId : null,
      submissionErrorCode: typeof errorCode === "string" ? errorCode.slice(0, 80) : null,
      attempts: typeof attempts === "number" && Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0,
    });
  }
  const emails = new Map<string, string | null>();
  for (const snap of userSnaps) {
    const email = snap.get("email");
    emails.set(snap.id, typeof email === "string" ? email : null);
  }
  return orders.map((order) => ({
    id: order.id,
    userId: order.userId,
    email: emails.get(order.userId) ?? null,
    serviceId: order.serviceId,
    serviceName: order.serviceName,
    status: order.status as AdminOrderFilter,
    salePriceMinor: order.salePriceMinor,
    supplierMinor: privateRows.get(order.id)?.supplierMinor ?? null,
    marginMinor: privateRows.get(order.id)?.marginMinor ?? null,
    supplierCurrency: privateRows.get(order.id)?.supplierCurrency ?? null,
    supplierOrderId: privateRows.get(order.id)?.supplierOrderId ?? null,
    submissionErrorCode: privateRows.get(order.id)?.submissionErrorCode ?? null,
    attempts: privateRows.get(order.id)?.attempts ?? 0,
    createdAt: order.createdAt,
  }));
}

export async function listUsers(role: "dealer" | null): Promise<
  Array<{ uid: string; email: string | null; displayName: string | null; role: string; createdAt: string | null }>
> {
  const database = getAdminFirestore();
  const base = database.collection(COLLECTIONS.users);
  const snapshot = await (role ? base.where("role", "==", role) : base).limit(80).get();
  return snapshot.docs.map((document) => ({
    uid: document.id,
    email: typeof document.get("email") === "string" ? document.get("email") : null,
    displayName: typeof document.get("displayName") === "string" ? document.get("displayName") : null,
    role: typeof document.get("role") === "string" ? document.get("role") : "user",
    createdAt: timestampToIso(document.get("createdAt")),
  }));
}

export async function listRecentAudit(): Promise<
  Array<{
    id: string;
    action: string;
    outcome: string;
    endpoint: string;
    userId: string | null;
    createdAt: string | null;
  }>
> {
  const snapshot = await getAdminFirestore()
    .collection(COLLECTIONS.auditLogs)
    .orderBy("createdAt", "desc")
    .limit(40)
    .get();
  return snapshot.docs.map((document) => ({
    id: document.id,
    action: typeof document.get("action") === "string" ? document.get("action") : "unknown",
    outcome: typeof document.get("outcome") === "string" ? document.get("outcome") : "unknown",
    endpoint: typeof document.get("endpoint") === "string" ? document.get("endpoint") : "",
    userId: typeof document.get("userId") === "string" ? document.get("userId") : null,
    createdAt: timestampToIso(document.get("createdAt")),
  }));
}
