"use client";

import { useEffect, useState } from "react";

import { balanceLevelLabel, formatMinorAmount } from "@/components/admin/format";
import { apiFetch, readPublicMessage } from "@/lib/api/browser";

type ProviderCard = {
  balanceMinor: number | null;
  currency: string | null;
  thresholdMinor: number;
  level: "normal" | "low" | "critical" | null;
  estimatedCostMinor: number;
  truncated: boolean;
};

const TONE: Record<string, string> = {
  normal: "bg-emerald-50 text-emerald-800",
  low: "bg-amber-50 text-amber-800",
  critical: "bg-red-50 text-red-800",
};

export default function AdminProviderPage() {
  const [data, setData] = useState<ProviderCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/admin/provider", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Sağlayıcı bakiyesi alınamadı.");
          return;
        }
        setData(body as ProviderCard);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Provider</h1>
        <p className="mt-1 text-sm text-slate-500">SMMFull bakiyesi sunucuda okunur. API anahtarı tarayıcıya gönderilmez.</p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">SMMFull Bakiyesi</p>
            <p className="mt-2 text-2xl font-semibold">{formatMinorAmount(data.balanceMinor, data.currency)}</p>
            <p className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${TONE[data.level ?? ""] ?? "bg-slate-100 text-slate-700"}`}>
              {balanceLevelLabel(data.level)}
            </p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Düşük Bakiye Eşiği</p>
            <p className="mt-2 text-2xl font-semibold">{formatMinorAmount(data.thresholdMinor, data.currency)}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Tahmini Gerekli Provider Maliyeti</p>
            <p className="mt-2 text-2xl font-semibold">{formatMinorAmount(data.estimatedCostMinor, data.currency)}</p>
            {data.truncated ? <p className="mt-2 text-xs text-slate-500">İlk 50 bekleyen sipariş toplandı.</p> : null}
          </article>
        </div>
      ) : null}
    </section>
  );
}
