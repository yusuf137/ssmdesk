import { z } from "zod";

import type { BillingProfile } from "@/lib/wallet/types";

const NAME = /^[\p{L}][\p{L} .'-]{0,58}[\p{L}]$/u;
const PHONE = /^(?:0|90|\+90)?5\d{9}$/;
const ADDRESS = /^[^\u0000-\u001F\u007F]{10,400}$/;

export const billingProfileSchema = z
  .object({
    fullName: z.string().trim().min(5).max(60),
    phone: z.string().trim().min(10).max(16),
    address: z.string().trim().min(10).max(400),
  })
  .strict();

export const publicBillingResponseSchema = z
  .object({
    profile: billingProfileSchema.nullable(),
  })
  .strict();

export function normalizeBillingProfile(input: {
  fullName: string;
  phone: string;
  address: string;
}): BillingProfile | null {
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const address = input.address.trim().replace(/\s+/g, " ");
  const compactPhone = input.phone.trim().replace(/[\s()-]/g, "");
  if (!NAME.test(fullName) || fullName.split(" ").length < 2) return null;
  const phoneMatch = PHONE.exec(compactPhone);
  if (!phoneMatch) return null;
  const national = compactPhone.replace(/^\+?90/, "0");
  const phone = national.startsWith("0") ? national : `0${national}`;
  if (!/^05\d{9}$/.test(phone)) return null;
  if (!ADDRESS.test(address)) return null;
  return { fullName, phone, address };
}

export function refundReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!/^[\p{L}0-9 .,'-]{1,80}$/u.test(trimmed)) return null;
  return trimmed;
}
