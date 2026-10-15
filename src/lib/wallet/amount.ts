import { AppError } from "@/lib/http/errors";
import { MAX_CUSTOM_TOPUP_MINOR, MIN_CUSTOM_TOPUP_MINOR } from "@/lib/wallet/types";

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+[.,]\d{1,2}$/;
const GROUPED_TR = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/;
const GROUPED_EN = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;

export function parseTryInputToMinor(value: string): number | null {
  const compact = value.trim().replace(/[\s\u00a0]/g, "");
  if (compact.length === 0 || compact.length > 16 || /[eE+-]/.test(compact)) return null;

  let major = "";
  let fraction = "";
  if (WHOLE.test(compact)) {
    major = compact;
  } else if (GROUPED_TR.test(compact)) {
    const [whole, frac = ""] = compact.split(",");
    major = whole.replace(/\./g, "");
    fraction = frac;
  } else if (GROUPED_EN.test(compact)) {
    const [whole, frac = ""] = compact.split(".");
    major = whole.replace(/,/g, "");
    fraction = frac;
  } else if (DECIMAL.test(compact)) {
    const separator = compact.includes(",") ? "," : ".";
    const [whole, frac] = compact.split(separator);
    major = whole ?? "";
    fraction = frac ?? "";
  } else {
    return null;
  }

  if (major.length === 0 || major.length > 7 || !/^\d+$/.test(major) || fraction.length > 2) return null;
  const majorNumber = Number(major);
  const fractionNumber = fraction.length === 0 ? 0 : Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(majorNumber) || !Number.isSafeInteger(fractionNumber) || fractionNumber > 99) return null;
  const minor = majorNumber * 100 + fractionNumber;
  return Number.isSafeInteger(minor) ? minor : null;
}

export function assertCustomTopupMinor(amount: number): number {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  if (amount < MIN_CUSTOM_TOPUP_MINOR) {
    throw new AppError("AMOUNT_TOO_LOW", 400, "Minimum bakiye yükleme tutarı 50 TL.");
  }
  if (amount > MAX_CUSTOM_TOPUP_MINOR) {
    throw new AppError("AMOUNT_TOO_HIGH", 400, "Maksimum bakiye yükleme tutarı 20.000 TL.");
  }
  return amount;
}
