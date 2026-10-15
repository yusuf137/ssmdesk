import { z } from "zod";

import { WALLET_LIST_CAP, WALLET_PAGE_SIZE } from "@/lib/constants";
import type { LedgerEntry } from "@/lib/wallet/types";

export const publicWalletSchema = z
  .object({
    balanceMinor: z.number().int().nonnegative(),
    currency: z.literal("TRY"),
  })
  .strict();

export const publicLedgerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{8,96}$/),
    type: z.enum(["topup", "order_debit", "refund", "admin_adjustment"]),
    amountMinor: z.number().int().positive(),
    currency: z.literal("TRY"),
    description: z.string().min(1).max(120),
    createdAt: z.string().min(1).max(40),
    orderId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    direction: z.enum(["credit", "debit"]).optional(),
  })
  .strict();

export const publicLedgerPageSchema = z
  .object({
    transactions: z.array(publicLedgerSchema).max(WALLET_PAGE_SIZE),
    page: z.number().int().positive(),
    pageSize: z.literal(WALLET_PAGE_SIZE),
    total: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
  })
  .strict();

export type PublicLedgerEntry = z.infer<typeof publicLedgerSchema>;

export function toPublicLedger(entry: LedgerEntry): PublicLedgerEntry {
  return {
    id: entry.id,
    type: entry.type,
    amountMinor: entry.amountMinor,
    currency: "TRY",
    description: entry.description,
    createdAt: entry.createdAt,
    orderId: entry.orderId,
    direction: entry.balanceAfterMinor < entry.balanceBeforeMinor ? "debit" : "credit",
  };
}

export function pageLedger(entries: LedgerEntry[], page: number): {
  entries: LedgerEntry[];
  total: number;
  page: number;
  pageCount: number;
} {
  const capped = entries.slice(0, WALLET_LIST_CAP);
  const pageCount = capped.length === 0 ? 0 : Math.ceil(capped.length / WALLET_PAGE_SIZE);
  const start = (page - 1) * WALLET_PAGE_SIZE;
  return {
    entries: start >= capped.length ? [] : capped.slice(start, start + WALLET_PAGE_SIZE),
    total: capped.length,
    page,
    pageCount,
  };
}
