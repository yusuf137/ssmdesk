"use client";

import { useEffect, useState } from "react";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { refillStatusLabel, type RefillStatus } from "@/lib/refill/policy";

const FILTERS = ["processing", "rejected", "unknown", "completed"] as const;

type Filter = (typeof FILTERS)[number];

type AdminRefill = {
  id: string;
  orderId: string;
  userId: string;
  email: string | null;
  providerOrderId: string;
  providerRefillId: string | null;
  status: RefillStatus;
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

export default function AdminRefillsPage() {
  const [filter, setFilter] = useState<Filter>("processing");
  const [refills, setRefills] = useState<AdminRefill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/admin/refills?status=${filter}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Refill talepleri alınamadı.");
          return;
        }
        setError(null);
        setRefills(Array.isArray(body?.refills) ? body.refills : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [filter, version]);

  async function checkStatus(refill: AdminRefill) {
    setPendingId(refill.id);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/refills/${encodeURIComponent(refill.id)}/sync`, { method: "POST" });
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
        <h1 className="text-2xl font-semibold text-slate-950">Refill</h1>
        <p className="mt-1 text-sm text-slate-500">Belirsiz talepler otomatik olarak yeniden gönderilmez.</p>
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
            {refillStatusLabel(item)}
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <ul className="space-y-3">
        {refills.map((refill) => (
          <li key={refill.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            {refill.status === "unknown" ? (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Refill sonucu belirsiz</p>
            ) : null}
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Sipariş</dt>
                <dd className="mt-1 break-all text-slate-950">{refill.orderId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Kullanıcı</dt>
                <dd className="mt-1 text-slate-950">{refill.email ?? refill.userId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sağlayıcı sipariş no</dt>
                <dd className="mt-1 text-slate-950">{refill.providerOrderId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sağlayıcı refill no</dt>
                <dd className="mt-1 text-slate-950">{refill.providerRefillId ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Durum</dt>
                <dd className="mt-1 font-medium text-slate-950">{refillStatusLabel(refill.status)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Hata kodu</dt>
                <dd className="mt-1 text-slate-950">{refill.internalErrorCode ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Oluşturulma</dt>
                <dd className="mt-1 text-slate-950">{formatWhen(refill.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Son kontrol</dt>
                <dd className="mt-1 text-slate-950">{formatWhen(refill.lastCheckedAt)}</dd>
              </div>
            </dl>
            <button
              type="button"
              disabled={pendingId === refill.id}
              onClick={() => void checkStatus(refill)}
              className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
            >
              Durumu Kontrol Et
            </button>
          </li>
        ))}
      </ul>
      {refills.length === 0 ? <p className="text-sm text-slate-500">Bu filtrede kayıt yok.</p> : null}
    </section>
  );
}
