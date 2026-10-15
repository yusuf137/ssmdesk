import { createHmac, timingSafeEqual } from "node:crypto";

export type PaytrTokenFields = {
  merchantId: string;
  userIp: string;
  merchantOid: string;
  email: string;
  paymentAmount: string;
  userBasket: string;
  noInstallment: string;
  maxInstallment: string;
  currency: string;
  testMode: string;
  merchantSalt: string;
  merchantKey: string;
};

export function createPaytrToken(fields: PaytrTokenFields): string {
  const payload =
    fields.merchantId +
    fields.userIp +
    fields.merchantOid +
    fields.email +
    fields.paymentAmount +
    fields.userBasket +
    fields.noInstallment +
    fields.maxInstallment +
    fields.currency +
    fields.testMode +
    fields.merchantSalt;

  return createHmac("sha256", fields.merchantKey).update(payload, "utf8").digest("base64");
}

export function verifyCallbackHash(input: {
  merchantOid: string;
  merchantSalt: string;
  status: string;
  totalAmount: string;
  merchantKey: string;
  hash: string;
}): boolean {
  const payload = input.merchantOid + input.merchantSalt + input.status + input.totalAmount;
  const expected = createHmac("sha256", input.merchantKey).update(payload, "utf8").digest("base64");
  const left = Buffer.from(expected);
  const right = Buffer.from(input.hash);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function mapPaytrStatus(status: string): "success" | "failed" | null {
  if (status === "success") return "success";
  if (status === "failed") return "failed";
  return null;
}
