export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "checking_provider_balance",
  "awaiting_provider_funds",
  "submitting",
  "submission_unknown",
  "in_progress",
  "completed",
  "partial",
  "cancel_requested",
  "cancel_processing",
  "cancel_pending_settlement",
  "cancelled",
  "failed",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_PENDING = "pending_payment" satisfies OrderStatus;

const LABELS: Record<OrderStatus, string> = {
  pending_payment: "Ödeme Bekleniyor",
  paid: "Ödendi",
  checking_provider_balance: "Sağlayıcı bakiyesi kontrol ediliyor",
  awaiting_provider_funds: "Sağlayıcı bakiyesi bekleniyor",
  submitting: "İletiliyor",
  submission_unknown: "Sağlayıcı sonucu belirsiz",
  in_progress: "İşleniyor",
  completed: "Tamamlandı",
  partial: "Kısmi",
  cancel_requested: "İptal Talep Edildi",
  cancel_processing: "İptal İşleniyor",
  cancel_pending_settlement: "İade Hesaplanıyor",
  cancelled: "İptal Edildi",
  failed: "Başarısız",
  refunded: "İade edildi",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && ORDER_STATUSES.some((status) => status === value);
}

export function orderStatusLabel(status: OrderStatus): string {
  return LABELS[status];
}
