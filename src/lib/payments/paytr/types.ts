export type PaytrConfig = {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
  testMode: "0" | "1";
  noInstallment: "0" | "1";
  maxInstallment: string;
  timeoutLimit: string;
  appBaseUrl: string;
};
