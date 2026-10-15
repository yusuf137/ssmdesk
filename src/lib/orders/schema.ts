import { z } from "zod";

import { MAX_ORDER_QUANTITY, MAX_TARGET_LENGTH } from "@/lib/constants";

export function isPublicHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_TARGET_LENGTH) return false;
  if (value !== value.trim()) return false;
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.hostname.length === 0) return false;
  return true;
}

const serviceIdSchema = z.union([
  z.number().int().positive().max(MAX_ORDER_QUANTITY),
  z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/)
    .transform((value) => Number(value))
    .pipe(z.number().int().positive().max(MAX_ORDER_QUANTITY)),
]);

export const createOrderSchema = z
  .object({
    serviceId: serviceIdSchema,
    targetUrl: z.string().trim().min(1).max(MAX_TARGET_LENGTH).refine(isPublicHttpUrl),
    quantity: z.number().int().positive().max(MAX_ORDER_QUANTITY),
    idempotencyKey: z.uuid(),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
