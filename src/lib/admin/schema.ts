import { z } from "zod";

const multiplier = z.number().finite().min(1).max(10);
const optionalMultiplier = multiplier.nullable();
const optionalMinor = z.number().int().positive().max(100_000_000).nullable();

export const MAX_ADMIN_ADJUSTMENT_MINOR = 100_000_000;

export const walletAdjustSchema = z
  .object({
    amountMinor: z
      .number()
      .int()
      .min(-MAX_ADMIN_ADJUSTMENT_MINOR)
      .max(MAX_ADMIN_ADJUSTMENT_MINOR)
      .refine((value) => value !== 0),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .regex(/^[^\u0000-\u001F\u007F]+$/),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const assignRoleSchema = z
  .object({
    role: z.enum(["user", "dealer"]),
  })
  .strict();

export const pricingUpdateSchema = z.union([
  z
    .object({
      type: z.literal("global"),
      userMultiplier: multiplier,
      dealerMultiplier: multiplier,
      minimumProfitMinor: z.number().int().min(0).max(100_000_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("service"),
      serviceId: z.number().int().positive(),
      enabled: z.boolean(),
      userFixedRateMinor: optionalMinor,
      dealerFixedRateMinor: optionalMinor,
      userMultiplier: optionalMultiplier,
      dealerMultiplier: optionalMultiplier,
    })
    .strict(),
  z
    .object({
      type: z.literal("category"),
      category: z.string().trim().min(1).max(120),
      userMultiplier: optionalMultiplier,
      dealerMultiplier: optionalMultiplier,
    })
    .strict(),
]);

export type PricingUpdate = z.infer<typeof pricingUpdateSchema>;
