"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { PageIntro } from "@/components/layout/page-intro";
import { OrderLink } from "@/components/orders/order-link";
import { formatTry } from "@/lib/orders/money";
import { orderStatusLabel } from "@/lib/orders/status";
import { cancelStatusLabel } from "@/lib/cancel/policy";
import { publicOrderResponseSchema, type OrderCancelView, type OrderRefillView, type PublicOrder } from "@/lib/orders/public-order";
import { refillStatusLabel } from "@/lib/refill/policy";

const countFormatter = new Intl.NumberFormat("tr-TR");

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatRefillDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function OrderDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = typeof params.id === "string" ? params.id : "";
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [refill, setRefill] = useState<OrderRefillView>({ canRequest: false, history: [] });
  const [cancel, setCancel] = useState<OrderCancelView>({ canRequest: false, history: [] });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (orderId.length === 0) return;
    const controller = new AbortController();

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}`, {
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setStatus("error");
          setError(readPublicMessage(payload) ?? "Sipariş bulunamadı.");
          return;
        }
        const parsed = publicOrderResponseSchema.safeParse(payload);
        if (!parsed.success) {
          setStatus("error");
          setError("Sipariş bulunamadı.");
          return;
        }
        setOrder(parsed.data.order);
        setRefill(parsed.data.refill ?? { canRequest: false, history: [] });
        setCancel(parsed.data.cancel ?? { canRequest: false, history: [] });
        setStatus("ready");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setStatus("error");
        setError("Bağlantı kurulamadı.");
      }
    }

    void load();
    return () => controller.abort();
  }, [orderId, router, version]);

  async function requestRefill() {
    if (pending || !refill.canRequest) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/refill`, {
        method: "POST",
        body: "{}",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readPublicMessage(payload) ?? "Refill talebi gönderilemedi.");
        return;
      }
      const message =
        payload !== null && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : "Refill talebiniz alındı.";
      setNotice(message.slice(0, 200));
      setVersion((current) => current + 1);
    } finally {
      setPending(false);
    }
  }

  async function requestCancel() {
    if (pending || !cancel.canRequest) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        body: "{}",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readPublicMessage(payload) ?? "İptal talebi gönderilemedi.");
        return;
      }
      const message =
        payload !== null && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : "İptal talebiniz alındı.";
      setNotice(message.slice(0, 200));
      setConfirmCancel(false);
      setVersion((current) => current + 1);
    } finally {
      setPending(false);
    }
  }

  return (
    <PageIntro title="Sipariş" description="Sipariş bakiyeden oluşturulur ve ardından işleme alınır.">
      {orderId.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center shadow-sm">
          <p role="alert" className="text-sm text-rose-700">
            Sipariş bulunamadı.
          </p>
          <Link href="/dashboard/orders" className="mt-4 inline-flex text-sm font-medium text-teal-800 hover:underline">
            Siparişlere dön
          </Link>
        </div>
      ) : null}
      {orderId.length > 0 && status === "loading" ? <p className="text-sm text-slate-500">Yükleniyor…</p> : null}
      {orderId.length > 0 && status === "error" ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center shadow-sm">
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
          <Link href="/dashboard/orders" className="mt-4 inline-flex text-sm font-medium text-teal-800 hover:underline">
            Siparişlere dön
          </Link>
        </div>
      ) : null}
      {orderId.length > 0 && status === "ready" && order ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {order.status === "pending_payment" ? (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p>Bu sipariş eski kayıtta ödeme bekliyor. Yeni siparişler bakiyeden oluşturulur.</p>
              <Link href="/dashboard/wallet" className="mt-2 inline-flex font-medium text-teal-800 hover:underline">
                Bakiye yükle
              </Link>
            </div>
          ) : null}
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Sipariş ID</dt>
              <dd className="mt-1 break-all font-medium text-slate-950">{order.id}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Hizmet</dt>
              <dd className="mt-1 text-slate-900">{order.serviceName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Kategori</dt>
              <dd className="mt-1 text-slate-900">{order.category}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Adet</dt>
              <dd className="mt-1 text-slate-900">{countFormatter.format(order.quantity)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Link</dt>
              <dd className="mt-1">
                <OrderLink url={order.targetUrl} />
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Tutar</dt>
              <dd className="mt-1 font-medium text-slate-950">{formatTry(order.salePriceMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Durum</dt>
              <dd className="mt-1 text-amber-800">{orderStatusLabel(order.status)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Oluşturulma</dt>
              <dd className="mt-1 text-slate-900">{formatCreatedAt(order.createdAt)}</dd>
            </div>
          </dl>
          {notice ? <p className="mt-4 text-sm text-teal-800">{notice}</p> : null}
          {error && status === "ready" ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {refill.canRequest ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void requestRefill()}
                className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Refill Talep Et
              </button>
            ) : null}
            {cancel.canRequest && !confirmCancel ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmCancel(true)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-60"
              >
                İptal Talep Et
              </button>
            ) : null}
          </div>
          {confirmCancel ? (
            <div className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-950">
              <p>Bu sipariş için sağlayıcıya iptal talebi gönderilecek. Teslim edilmiş kısım varsa yalnızca uygun kalan tutar iade edilebilir.</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void requestCancel()}
                  className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Onayla
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmCancel(false)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-950">Refill Geçmişi</h2>
            {refill.history.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Refill talebi yok.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {refill.history.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-slate-500">{formatRefillDate(entry.requestedAt)}</span>
                    <span className="font-medium text-slate-900">{refillStatusLabel(entry.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-950">İptal Geçmişi</h2>
            {cancel.history.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">İptal talebi yok.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {cancel.history.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-slate-500">{formatRefillDate(entry.requestedAt)}</span>
                    <span className="font-medium text-slate-900">{cancelStatusLabel(entry.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link href="/dashboard/orders" className="mt-6 inline-flex text-sm font-medium text-teal-800 hover:underline">
            Siparişlere dön
          </Link>
        </section>
      ) : null}
    </PageIntro>
  );
}
