"use client";

import { useEffect, useState } from "react";

import { balanceLevelLabel, formatMinorAmount } from "@/components/admin/format";
import { apiFetch, readPublicMessage } from "@/lib/api/browser";

type Overview = {
  userCount: number;
  dealerCount: number;
  pendingCount: number;
  awaitingCount: number;
  provider: {
    balanceMinor: number | null;
    currency: string | null;
    thresholdMinor: number;
    level: "normal" | "low" | "critical" | null;
  };
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/admin/overview", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Özet alınamadı.");
          return;
        }
        setData(body as Overview);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const cards = data
    ? [
        ["Toplam Kullanıcı", String(data.userCount)],
        ["Bayi Sayısı", String(data.dealerCount)],
        ["Pending Orders", String(data.pendingCount)],
        ["Awaiting Provider Funds", String(data.awaitingCount)],
        ["SMMFull Balance", formatMinorAmount(data.provider.balanceMinor, data.provider.currency)],
      ]
    : [];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Genel Bakış</h1>
        <p className="mt-1 text-sm text-slate-500">Kullanıcılar, bekleyen siparişler ve sağlayıcı bakiyesi.</p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-slate-500">Yükleniyor…</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
          </article>
        ))}
      </div>
      {data ? (
        <p className="text-sm text-slate-600">
          Sağlayıcı durumu: {balanceLevelLabel(data.provider.level)}. Eşik{" "}
          {formatMinorAmount(data.provider.thresholdMinor, data.provider.currency)}. Tutarlar sağlayıcı para birimindedir.
        </p>
      ) : null}
    </section>
  );
}
