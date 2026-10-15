"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiFetch } from "@/lib/api/browser";
import { publicOrderResponseSchema } from "@/lib/orders/public-order";
import { orderStatusLabel, type OrderStatus } from "@/lib/orders/status";

export function PaymentResult({ page }: { page: "success" | "failed" }) {
  const params = useSearchParams();
  const orderId = params.get("orderId") ?? "";
  const [status, setStatus] = useState<OrderStatus | null>(null);

  useEffect(() => {
    if (!/^[a-f0-9]{64}$/.test(orderId)) return;
    const controller = new AbortController();
    void apiFetch(`/api/orders/${orderId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        const parsed = publicOrderResponseSchema.safeParse(payload);
        if (parsed.success) setStatus(parsed.data.order.status);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [orderId]);

  const walletReturn = !/^[a-f0-9]{64}$/.test(orderId);
  const headline = walletReturn
    ? "Bakiye doğrulanıyor"
    : status === "paid" || status === "submitting"
      ? "Ödeme alındı."
      : "Ödeme doğrulanıyor";
  const detail = walletReturn
    ? "Yönlendirme bakiye yüklemesinin kanıtı değildir. Bakiye, doğrulanmış ödeme bildiriminden sonra güncellenir."
    : page === "failed" && status === "pending_payment"
      ? "Ödeme tamamlanmadı. Sipariş ödeme beklemeye devam ediyor."
      : "Sipariş durumu yalnızca doğrulanmış ödeme bildirimi ile güncellenir.";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center px-4 py-16">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-950">{headline}</h1>
        <p className="mt-3 text-sm text-slate-600">{detail}</p>
        {status ? <p className="mt-4 text-sm font-medium text-slate-900">{orderStatusLabel(status)}</p> : null}
        <Link href={walletReturn ? "/dashboard/wallet" : `/dashboard/orders/${orderId}`} className="mt-6 inline-flex text-sm font-medium text-slate-950 underline">
          {walletReturn ? "Bakiye sayfasına dön" : "Siparişe dön"}
        </Link>
      </section>
    </main>
  );
}
