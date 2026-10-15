"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";

type Pricing = {
  userMultiplier: number;
  dealerMultiplier: number;
  minimumProfitMinor: number;
};

export default function AdminPricingPage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [dealerFixed, setDealerFixed] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/admin/pricing", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Fiyatlar alınamadı.");
          return;
        }
        setPricing(body as Pricing);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function saveGlobal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pricing || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiFetch("/api/admin/pricing", {
        method: "POST",
        body: JSON.stringify({ type: "global", ...pricing }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(readPublicMessage(body) ?? "Fiyat güncellenemedi.");
    } finally {
      setPending(false);
    }
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const id = Number(serviceId);
    const minor = dealerFixed.trim() === "" ? null : Number(dealerFixed);
    if (!Number.isInteger(id) || id <= 0) {
      setError("Servis numarası geçersiz.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await apiFetch("/api/admin/pricing", {
        method: "POST",
        body: JSON.stringify({
          type: "service",
          serviceId: id,
          enabled: true,
          userFixedRateMinor: null,
          dealerFixedRateMinor: minor,
          userMultiplier: null,
          dealerMultiplier: null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(readPublicMessage(body) ?? "Servis fiyatı güncellenemedi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Fiyatlandırma</h1>
        <p className="mt-1 text-sm text-slate-500">Çarpanlar 1 ile 10 arasında olmalıdır. Sıfır ve negatif kabul edilmez.</p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {pricing ? (
        <form onSubmit={saveGlobal} className="grid max-w-xl gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <label className="text-sm font-medium text-slate-700">
            Normal kullanıcı çarpanı
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
              value={pricing.userMultiplier}
              onChange={(event) => setPricing({ ...pricing, userMultiplier: Number(event.target.value) })}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Bayi çarpanı
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
              value={pricing.dealerMultiplier}
              onChange={(event) => setPricing({ ...pricing, dealerMultiplier: Number(event.target.value) })}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Minimum kâr (kuruş)
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
              value={pricing.minimumProfitMinor}
              onChange={(event) => setPricing({ ...pricing, minimumProfitMinor: Number(event.target.value) })}
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-xl bg-slate-950 text-sm font-semibold text-white disabled:opacity-60"
          >
            Kaydet
          </button>
        </form>
      ) : null}
      <form onSubmit={saveService} className="grid max-w-xl gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Servis özel fiyatı</h2>
        <label className="text-sm font-medium text-slate-700">
          Servis numarası
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Bayi sabit fiyat (kuruş / 1000)
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={dealerFixed}
            onChange={(event) => setDealerFixed(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 disabled:opacity-60"
        >
          Servis fiyatını kaydet
        </button>
      </form>
    </section>
  );
}
