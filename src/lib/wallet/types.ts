export const TOPUP_PACKAGES = [
  { id: "p500", amountMinor: 50_000, label: "500 TL" },
  { id: "p1000", amountMinor: 100_000, label: "1.000 TL" },
  { id: "p2500", amountMinor: 250_000, label: "2.500 TL" },
  { id: "p5000", amountMinor: 500_000, label: "5.000 TL" },
] as const;

export const TOPUP_PACKAGES_MINOR = [50_000, 100_000, 250_000, 500_000] as const;

export const MIN_CUSTOM_TOPUP_MINOR = 5_000;
export const MAX_CUSTOM_TOPUP_MINOR = 2_000_000;

export type TopupPackageId = (typeof TOPUP_PACKAGES)[number]["id"];

export type WalletRecord = {
  userId: string;
  balanceMinor: number;
  currency: "TRY";
  createdAt: string;
  updatedAt: string;
};

export type LedgerType = "topup" | "order_debit" | "refund" | "admin_adjustment";

export type LedgerEntry = {
  id: string;
  userId: string;
  type: LedgerType;
  amountMinor: number;
  currency: "TRY";
  balanceBeforeMinor: number;
  balanceAfterMinor: number;
  paymentId: string | null;
  orderId: string | null;
  referenceId: string;
  description: string;
  createdAt: string;
};

export type BillingProfile = {
  fullName: string;
  phone: string;
  address: string;
};

export function findTopupPackage(packageId: string): { id: TopupPackageId; amountMinor: number } | null {
  const match = TOPUP_PACKAGES.find((item) => item.id === packageId);
  return match ? { id: match.id, amountMinor: match.amountMinor } : null;
}

export function topupLedgerId(paymentId: string): string {
  return `topup_${paymentId}`;
}

export function debitLedgerId(orderId: string): string {
  return `debit_${orderId}`;
}

export function refundLedgerId(orderId: string): string {
  return `refund_${orderId}`;
}
