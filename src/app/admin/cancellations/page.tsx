"use client";

import { useEffect, useState } from "react";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { cancelStatusLabel, type CancelStatus } from "@/lib/cancel/policy";

const FILTERS = ["processing", "accepted", "rejected", "unknown", "pending_settlement", "completed"] as const;

type Filter = (typeof FILTERS)[number];

type AdminCancel = {
  id: string;
  orderId: string;
  userId: string;
  email: string | null;
  providerOrderId: string;
  status: CancelStatus;
  createdAt: string;
  lastCheckedAt: string | null;
  internalErrorCode: string | null;
};

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function AdminCancellationsPage() {
  const [filter, setFilter] = useState<Filter>("processing");
  const [cancellations, setCancellations] = useState<AdminCancel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/admin/cancellations?status=${filter}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "İptal talepleri alınamadı.");
          return;
        }
        setError(null);
        setCancellations(Array.isArray(body?.cancellations) ? body.cancellations : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [filter, version]);

  async function checkStatus(cancel: AdminCancel) {
    setPendingId(cancel.id);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/cancellations/${encodeURIComponent(cancel.id)}/sync`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readPublicMessage(body) ?? "Durum kontrol edilemedi.");
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
        <h1 className="text-2xl font-semibold text-slate-950">İptaller</h1>
        <p className="mt-1 text-sm text-slate-500">Belirsiz talepler otomatik olarak yeniden gönderilmez. İade, sağlayıcı durumu netleşmeden yapılmaz.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`rounded-xl px-3 py-2 text-xs font-semibold ${
              filter === item ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-800"
            }`}
          >
            {cancelStatusLabel(item)}
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <ul className="space-y-3">
        {cancellations.map((cancel) => (
          <li key={cancel.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            {cancel.status === "unknown" ? (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">İptal sonucu belirsiz</p>
            ) : null}
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Sipariş</dt>
                <dd className="mt-1 break-all text-slate-950">{cancel.orderId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Kullanıcı</dt>
                <dd className="mt-1 text-slate-950">{cancel.email ?? cancel.userId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sağlayıcı sipariş no</dt>
                <dd className="mt-1 text-slate-950">{cancel.providerOrderId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Durum</dt>
                <dd className="mt-1 font-medium text-slate-950">{cancelStatusLabel(cancel.status)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Hata kodu</dt>
                <dd className="mt-1 text-slate-950">{cancel.internalErrorCode ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Oluşturulma</dt>
                <dd className="mt-1 text-slate-950">{formatWhen(cancel.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Son kontrol</dt>
                <dd className="mt-1 text-slate-950">{formatWhen(cancel.lastCheckedAt)}</dd>
              </div>
            </dl>
            <button
              type="button"
              disabled={pendingId === cancel.id}
              onClick={() => void checkStatus(cancel)}
              className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
            >
              Durumu Kontrol Et
            </button>
          </li>
        ))}
      </ul>
      {cancellations.length === 0 ? <p className="text-sm text-slate-500">Bu filtrede kayıt yok.</p> : null}
    </section>
  );
}
