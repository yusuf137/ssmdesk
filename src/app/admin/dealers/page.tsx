"use client";

import { useEffect, useState } from "react";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";

type Dealer = { uid: string; email: string | null; displayName: string | null; createdAt: string | null };

export default function AdminDealersPage() {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/admin/users?role=dealer", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Bayiler alınamadı.");
          return;
        }
        setDealers(Array.isArray(body?.users) ? body.users : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Bayiler</h1>
        <p className="mt-1 text-sm text-slate-500">Bayiler aynı cüzdanı kullanır, daha düşük çarpanla fiyat görür.</p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {dealers.map((dealer) => (
          <li key={dealer.uid} className="px-4 py-3">
            <p className="font-medium text-slate-950">{dealer.email ?? dealer.uid}</p>
            <p className="text-xs text-slate-500">{dealer.displayName ?? "İsimsiz"}</p>
          </li>
        ))}
        {dealers.length === 0 && !error ? <li className="px-4 py-6 text-sm text-slate-500">Bayi yok.</li> : null}
      </ul>
    </section>
  );
}
