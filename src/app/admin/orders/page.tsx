"use client";

import { useEffect, useState } from "react";

import { formatMinorAmount } from "@/components/admin/format";
import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { formatTryLabel } from "@/lib/orders/money";
import { orderStatusLabel, type OrderStatus } from "@/lib/orders/status";

const FILTERS = [
  "paid",
  "checking_provider_balance",
  "awaiting_provider_funds",
  "submitting",
  "submission_unknown",
  "in_progress",
  "failed",
  "refunded",
] as const;

type Filter = (typeof FILTERS)[number];

type AdminOrder = {
  id: string;
  email: string | null;
  userId: string;
  serviceId: number;
  serviceName: string;
  status: OrderStatus;
  salePriceMinor: number;
  supplierMinor: number | null;
  marginMinor: number | null;
  supplierCurrency: string | null;
  supplierOrderId: string | null;
  submissionErrorCode: string | null;
  attempts: number;
  createdAt: string;
};

export default function AdminOrdersPage() {
  const [filter, setFilter] = useState<Filter>("awaiting_provider_funds");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/admin/orders?status=${filter}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Siparişler alınamadı.");
          return;
        }
        setError(null);
        setOrders(Array.isArray(body?.orders) ? body.orders : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [filter, version]);

  async function retry(order: AdminOrder) {
    setPendingId(order.id);
    setError(null);
    try {
      const unknown = order.status === "submission_unknown" || order.status === "submitting";
      const response = await apiFetch(
        unknown ? `/api/admin/orders/${order.id}/retry-provider` : `/api/admin/orders/${order.id}/retry`,
        unknown ? { method: "POST", body: JSON.stringify({ confirmUnknown: true }) } : { method: "POST" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readPublicMessage(body) ?? "İşlem tamamlanamadı.");
        return;
      }
      setVersion((current) => current + 1);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Siparişler</h1>
        <p className="mt-1 text-sm text-slate-500">Sağlayıcı gönderimi yalnızca sunucuda yapılır.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === item ? "bg-slate-950 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {orderStatusLabel(item)}
          </button>
        ))}
      </div>
      {filter === "submission_unknown" || filter === "submitting" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Sağlayıcı sonucu belirsiz. Provider ilk isteği almış olabilir. Tekrar gönderim duplicate hizmet oluşturabilir.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="space-y-3">
        {orders.map((order) => {
          const sameCurrency = order.supplierCurrency === "TRY" || order.supplierCurrency === "TL";
          const unknown = order.status === "submission_unknown" || order.status === "submitting";
          const safeRetry =
            order.status === "awaiting_provider_funds" ||
            order.status === "paid" ||
            order.status === "checking_provider_balance";
          return (
            <article key={order.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-950">{order.serviceName}</p>
                  <p className="text-xs text-slate-500">
                    {order.email ?? order.userId} · #{order.serviceId} · {orderStatusLabel(order.status)}
                  </p>
                </div>
                {safeRetry || unknown ? (
                  <button
                    type="button"
                    disabled={pendingId === order.id}
                    onClick={() => void retry(order)}
                    className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {pendingId === order.id ? "Deneniyor…" : safeRetry ? "Tekrar Dene" : "Kontrol Et"}
                  </button>
                ) : null}
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-slate-500">Müşteri ödemesi</dt>
                  <dd>{formatTryLabel(order.salePriceMinor)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Sağlayıcı tutarı</dt>
                  <dd>{formatMinorAmount(order.supplierMinor, order.supplierCurrency)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Marj</dt>
                  <dd>
                    {order.marginMinor === null
                      ? "—"
                      : sameCurrency
                        ? formatTryLabel(order.marginMinor)
                        : `${formatMinorAmount(order.marginMinor, null)} (kur çevrilmedi)`}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Sağlayıcı sipariş no</dt>
                  <dd>{order.supplierOrderId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Deneme</dt>
                  <dd>{order.attempts}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Gönderim notu</dt>
                  <dd>{order.submissionErrorCode ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Tarih</dt>
                  <dd>{order.createdAt}</dd>
                </div>
              </dl>
            </article>
          );
        })}
        {orders.length === 0 && !error ? <p className="text-sm text-slate-500">Bu durumda sipariş yok.</p> : null}
      </div>
    </section>
  );
}
