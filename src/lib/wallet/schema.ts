import { z } from "zod";

import { MAX_CUSTOM_TOPUP_MINOR, MIN_CUSTOM_TOPUP_MINOR, TOPUP_PACKAGES } from "@/lib/wallet/types";

const packageIdSchema = z.enum(TOPUP_PACKAGES.map((item) => item.id) as ["p500", "p1000", "p2500", "p5000"]);

export const topupInitSchema = z.union([
  z
    .object({
      packageId: packageIdSchema,
    })
    .strict(),
  z
    .object({
      customAmountMinor: z.number().int().min(MIN_CUSTOM_TOPUP_MINOR).max(MAX_CUSTOM_TOPUP_MINOR),
    })
    .strict(),
]);
