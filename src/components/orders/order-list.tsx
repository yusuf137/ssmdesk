"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { formatTry } from "@/lib/orders/money";
import { publicOrderListSchema, type PublicOrder } from "@/lib/orders/public-order";
import { orderStatusLabel } from "@/lib/orders/status";
import { OrderLink } from "@/components/orders/order-link";

const countFormatter = new Intl.NumberFormat("tr-TR");

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function OrderList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const response = await apiFetch(`/api/orders?page=${page}`, { signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setStatus("error");
          setError(readPublicMessage(payload) ?? "Siparişler alınamadı.");
          return;
        }
        const parsed = publicOrderListSchema.safeParse(payload);
        if (!parsed.success) {
          setStatus("error");
          setError("Siparişler alınamadı.");
          return;
        }
        setOrders(parsed.data.orders);
        setPageCount(parsed.data.pageCount);
        setTotal(parsed.data.total);
        setStatus("ready");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setStatus("error");
        setError("Bağlantı kurulamadı.");
      }
    }

    void load();
    return () => controller.abort();
  }, [page, reloadKey, router]);

  if (status === "loading") {
    return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  }

  if (status === "error") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center shadow-sm">
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
        <button
          type="button"
          onClick={() => setReloadKey((current) => current + 1)}
          className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center shadow-sm">
        <p className="text-sm text-slate-500">Henüz sipariş yok.</p>
        <Link
          href="/dashboard/orders/new"
          className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Yeni sipariş
        </Link>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Sipariş</th>
              <th className="px-4 py-3 font-medium">Hizmet</th>
              <th className="px-4 py-3 font-medium">Link</th>
              <th className="px-4 py-3 font-medium">Adet</th>
              <th className="px-4 py-3 font-medium">Tutar</th>
              <th className="px-4 py-3 font-medium">Durum</th>
              <th className="px-4 py-3 font-medium">Tarih</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/orders/${order.id}`} className="font-medium text-teal-800 hover:underline">
                    {order.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-900">{order.serviceName}</td>
                <td className="max-w-xs px-4 py-3">
                  <OrderLink url={order.targetUrl} />
                </td>
                <td className="px-4 py-3 text-slate-700">{countFormatter.format(order.quantity)}</td>
                <td className="px-4 py-3 text-slate-900">{formatTry(order.salePriceMinor)}</td>
                <td className="px-4 py-3 text-amber-800">{orderStatusLabel(order.status)}</td>
                <td className="px-4 py-3 text-slate-500">{formatCreatedAt(order.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 p-4 md:hidden">
        {orders.map((order) => (
          <article key={order.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/dashboard/orders/${order.id}`} className="text-sm font-semibold text-teal-800">
                  {order.serviceName}
                </Link>
                <p className="mt-1 text-xs text-slate-500">{formatCreatedAt(order.createdAt)}</p>
              </div>
              <p className="text-sm font-medium text-slate-900">{formatTry(order.salePriceMinor)}</p>
            </div>
            <p className="mt-3 text-sm">
              <OrderLink url={order.targetUrl} />
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {countFormatter.format(order.quantity)} adet · {orderStatusLabel(order.status)}
            </p>
          </article>
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => router.push(`/dashboard/orders?page=${page - 1}`)}
            className="rounded-xl border border-slate-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Önceki
          </button>
          <p className="text-slate-500">
            Sayfa {page} / {pageCount}
          </p>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => router.push(`/dashboard/orders?page=${page + 1}`)}
            className="rounded-xl border border-slate-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sonraki
          </button>
        </div>
      ) : null}
    </section>
  );
}
