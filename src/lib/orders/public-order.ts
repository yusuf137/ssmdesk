import { z } from "zod";

import { ORDERS_PAGE_SIZE } from "@/lib/constants";
import { ORDER_CURRENCY } from "@/lib/orders/money";
import type { OrderRecord } from "@/lib/orders/repository";
import { ORDER_STATUSES } from "@/lib/orders/status";
import { publicCancelSchema } from "@/lib/cancel/policy";
import { publicRefillSchema } from "@/lib/refill/policy";

export const publicOrderSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    serviceId: z.number().int().positive(),
    serviceName: z.string().min(1),
    category: z.string(),
    targetUrl: z.string().min(1),
    quantity: z.number().int().positive(),
    salePriceMinor: z.number().int().positive(),
    currency: z.literal(ORDER_CURRENCY),
    status: z.enum(ORDER_STATUSES),
    createdAt: z.string().min(1).max(40),
  })
  .strict();

export const orderRefillViewSchema = z
  .object({
    canRequest: z.boolean(),
    history: z.array(publicRefillSchema).max(20),
  })
  .strict();

export type OrderRefillView = z.infer<typeof orderRefillViewSchema>;

export const orderCancelViewSchema = z
  .object({
    canRequest: z.boolean(),
    history: z.array(publicCancelSchema).max(20),
  })
  .strict();

export type OrderCancelView = z.infer<typeof orderCancelViewSchema>;

export const publicOrderResponseSchema = z
  .object({
    order: publicOrderSchema,
    refill: orderRefillViewSchema.optional(),
    cancel: orderCancelViewSchema.optional(),
  })
  .strict();

export const publicOrderListSchema = z
  .object({
    orders: z.array(publicOrderSchema).max(ORDERS_PAGE_SIZE),
    page: z.number().int().positive(),
    pageSize: z.literal(ORDERS_PAGE_SIZE),
    total: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
  })
  .strict();

export type PublicOrder = z.infer<typeof publicOrderSchema>;

const PUBLIC_ORDER_KEYS = [
  "id",
  "serviceId",
  "serviceName",
  "category",
  "targetUrl",
  "quantity",
  "salePriceMinor",
  "currency",
  "status",
  "createdAt",
] as const;

export function toPublicOrder(record: OrderRecord): PublicOrder {
  const order: PublicOrder = {
    id: record.id,
    serviceId: record.serviceId,
    serviceName: record.serviceName,
    category: record.category,
    targetUrl: record.targetUrl,
    quantity: record.quantity,
    salePriceMinor: record.salePriceMinor,
    currency: record.currency,
    status: record.status,
    createdAt: record.createdAt,
  };

  const keys = Object.keys(order);
  if (keys.length !== PUBLIC_ORDER_KEYS.length || PUBLIC_ORDER_KEYS.some((key) => !keys.includes(key))) {
    throw new Error("public_order_shape");
  }
  return order;
}
