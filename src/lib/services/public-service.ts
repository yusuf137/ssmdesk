import { z } from "zod";

import { MAX_PROVIDER_SERVICES, TEXT_LIMITS } from "@/lib/constants";

export const publicServiceSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(TEXT_LIMITS.serviceName),
    category: z.string().max(TEXT_LIMITS.category),
    type: z.string().min(1).max(TEXT_LIMITS.serviceType),
    salePrice: z.number().nonnegative().refine((value) => Number.isFinite(value)),
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    refill: z.boolean(),
    cancel: z.boolean(),
  })
  .strict();

export const publicCatalogSchema = z
  .object({
    services: z.array(publicServiceSchema).max(MAX_PROVIDER_SERVICES),
  })
  .strict();

export type PublicService = z.infer<typeof publicServiceSchema>;

export function toPublicService(service: PublicService): PublicService {
  return {
    id: service.id,
    name: service.name,
    category: service.category,
    type: service.type,
    salePrice: service.salePrice,
    min: service.min,
    max: service.max,
    refill: service.refill,
    cancel: service.cancel,
  };
}
