export type ProviderService = {
  id: number;
  name: string;
  category: string;
  type: string;
  costPrice: number;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
};

export type ProviderCreateOrderInput = {
  serviceId: number;
  quantity: number;
  link?: string;
  targetUrl?: string;
};

export type ProviderCreateOrderResult = {
  providerOrderId: string;
};

export type ProviderOrderStatus = {
  providerOrderId: string;
  status: string;
  charge: number | null;
  startCount: number | null;
  remains: number | null;
};

export type ProviderBalance = {
  balance: number;
  balanceMinor: number;
  currency: string | null;
};

export type ProviderRefillResult = {
  providerRefillId: string;
};

export type ProviderRefillStatus = {
  providerRefillId: string;
  status: string;
};

export interface SmmProvider {
  getServices(): Promise<ProviderService[]>;
  createOrder(input: ProviderCreateOrderInput): Promise<ProviderCreateOrderResult>;
  getOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus>;
  getBalance(): Promise<ProviderBalance>;
  requestRefill(providerOrderId: string): Promise<ProviderRefillResult>;
  getRefillStatus(providerRefillId: string): Promise<ProviderRefillStatus>;
  requestCancel(providerOrderId: string): Promise<{ accepted: true }>;
}
