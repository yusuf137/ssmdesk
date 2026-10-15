import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireApiUser } from "@/lib/auth/session";
import { ORDER_BODY_MAX_BYTES, ORDERS_PAGE_SIZE, RATE_LIMITS } from "@/lib/constants";
import { withApi } from "@/lib/http/api-handler";
import { getClientIp } from "@/lib/http/client-ip";
import { AppError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/read-json";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { writeAuditLog } from "@/lib/logging/audit";
import { createFirestoreOrderRepository } from "@/lib/orders/firestore-repository";
import { placeOrder } from "@/lib/orders/place-order";
import { placePaidOrderFirestore } from "@/lib/wallet/firestore-checkout";
import { toPublicOrder } from "@/lib/orders/public-order";
import { readOrderListQuery } from "@/lib/orders/query";
import { submitPaidOrder } from "@/lib/provider/submit-order";
import { getOrderableService } from "@/lib/services/catalog";

const REJECTED_CODES = new Set([
  "SERVICE_UNAVAILABLE",
  "QUANTITY_TOO_LOW",
  "QUANTITY_TOO_HIGH",
  "PRICE_UNAVAILABLE",
]);

function numericField(body: unknown, key: "serviceId" | "quantity"): number {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return 0;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
  return 0;
}

export const GET = withApi(
  async (context) => {
    await enforceRateLimit({ route: "orders-read", kind: "global" }, RATE_LIMITS.orderReadGlobal, {
      scope: "orders_read_global",
      critical: true,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "orders-read", kind: "ip", value: ip }, RATE_LIMITS.orderReadIp, {
        scope: "orders_read_ip",
        critical: true,
      });
    }

    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "orders-read", kind: "user", value: user.uid }, RATE_LIMITS.orderStatusUser, {
      scope: "orders_read_user",
      critical: true,
    });

    const page = readOrderListQuery(new URL(context.request.url));
    const listed = await createFirestoreOrderRepository().listByUser(user.uid, page);
    return NextResponse.json({
      orders: listed.records.map((record) => toPublicOrder(record)),
      page: listed.page,
      pageSize: ORDERS_PAGE_SIZE,
      total: listed.total,
      pageCount: listed.pageCount,
    });
  },
  { mutation: false },
);

export const POST = withApi(
  async (context) => {
    await enforceRateLimit({ route: "orders-create", kind: "global" }, RATE_LIMITS.ordersGlobal, {
      scope: "orders_create_global",
      critical: true,
    });
    const ip = getClientIp(context.request);
    if (ip) {
      await enforceRateLimit({ route: "orders-create", kind: "ip", value: ip }, RATE_LIMITS.ordersIp, {
        scope: "orders_create_ip",
        critical: true,
      });
    }

    const user = await requireApiUser();
    context.setUserId(user.uid);
    await enforceRateLimit({ route: "orders-create", kind: "user", value: user.uid }, RATE_LIMITS.ordersUser, {
      scope: "orders_create_user",
      critical: true,
    });

    const body = await readJson(context.request, ORDER_BODY_MAX_BYTES);

    try {
      const result = await placeOrder({
        userId: user.uid,
        body,
        findService: (serviceId) => getOrderableService(serviceId, user.role),
        orders: { placePaidOrder: placePaidOrderFirestore },
      });

      await writeAuditLog({
        action: result.created ? "ORDER_CREATED" : "ORDER_IDEMPOTENCY_HIT",
        requestId: context.requestId,
        endpoint: context.endpoint,
        outcome: "success",
        userId: user.uid,
        metadata: {
          orderId: result.order.id,
          serviceId: result.order.serviceId,
          quantity: result.order.quantity,
        },
      });
      if (result.created) {
        await writeAuditLog({
          action: "WALLET_ORDER_DEBIT",
          requestId: context.requestId,
          endpoint: context.endpoint,
          outcome: "success",
          userId: user.uid,
          metadata: {
            orderId: result.order.id,
            amountMinor: result.order.salePriceMinor,
          },
        });
      }

      let order = result.order;
      if (result.created) {
        await submitPaidOrder(result.order.id).catch(() => undefined);
        const fresh = await createFirestoreOrderRepository().getForUser(result.order.id, user.uid);
        if (fresh) order = toPublicOrder(fresh);
      }

      return NextResponse.json({ order }, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof AppError && error.code === "INSUFFICIENT_BALANCE") {
        await writeAuditLog({
          action: "WALLET_INSUFFICIENT_BALANCE",
          requestId: context.requestId,
          endpoint: context.endpoint,
          outcome: "failure",
          userId: user.uid,
          metadata: {
            serviceId: numericField(body, "serviceId"),
            quantity: numericField(body, "quantity"),
          },
        });
      }
      if (error instanceof ZodError || (error instanceof AppError && REJECTED_CODES.has(error.code))) {
        await writeAuditLog({
          action: "ORDER_VALIDATION_FAILED",
          requestId: context.requestId,
          endpoint: context.endpoint,
          outcome: "failure",
          userId: user.uid,
          metadata: {
            code: error instanceof AppError ? error.code : "INVALID_REQUEST",
            serviceId: numericField(body, "serviceId"),
            quantity: numericField(body, "quantity"),
          },
        });
      }
      throw error;
    }
  },
  { mutation: true },
);
