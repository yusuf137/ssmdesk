"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { browseServices, type FlagFilter } from "@/lib/services/browse";
import { publicCatalogSchema, type PublicService } from "@/lib/services/public-service";

const priceFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const countFormatter = new Intl.NumberFormat("tr-TR");

const fieldClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20";

function logServicesFailure(status: number, payload: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  // Development correlation only: status, error code, and request id.
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      endpoint: "/api/services",
      status,
      errorCode: typeof record?.error === "string" ? record.error : null,
      requestId: typeof record?.requestId === "string" ? record.requestId : null,
    }),
  );
}

export function ServiceBrowser() {
  const router = useRouter();
  const [services, setServices] = useState<PublicService[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [refill, setRefill] = useState<FlagFilter>("all");
  const [cancel, setCancel] = useState<FlagFilter>("all");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const response = await apiFetch("/api/services", { signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          logServicesFailure(response.status, payload);
          setStatus("error");
          setError(readPublicMessage(payload) ?? "Hizmet listesi alınamadı.");
          return;
        }

        const parsed = publicCatalogSchema.safeParse(payload);
        if (!parsed.success) {
          logServicesFailure(response.status, payload);
          setStatus("error");
          setError("Hizmet listesi alınamadı.");
          return;
        }

        setServices(parsed.data.services);
        setStatus("ready");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setStatus("error");
        setError("Bağlantı kurulamadı.");
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey, router]);

  const result = useMemo(
    () => browseServices(services, { query, category, refill, cancel, page }),
    [cancel, category, page, query, refill, services],
  );

  function updateQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function updateCategory(value: string) {
    setCategory(value);
    setPage(1);
  }

  function updateRefill(value: FlagFilter) {
    setRefill(value);
    setPage(1);
  }

  function updateCancel(value: FlagFilter) {
    setCancel(value);
    setPage(1);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="block text-sm font-medium text-slate-700 xl:col-span-1" htmlFor="service-search">
          Ara
          <input
            id="service-search"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Hizmet, kategori veya ID"
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700" htmlFor="service-category">
          Kategori
          <select
            id="service-category"
            value={category}
            onChange={(event) => updateCategory(event.target.value)}
            className={fieldClass}
          >
            <option value="">Tümü</option>
            {result.categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <FlagSelect id="service-refill" label="Refill" value={refill} onChange={updateRefill} />
        <FlagSelect id="service-cancel" label="Cancel" value={cancel} onChange={updateCancel} />
      </div>

      {status === "loading" ? <ServiceSkeleton /> : null}
      {status === "error" ? (
        <div className="px-4 py-10 text-center">
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
      ) : null}
      {status === "ready" && result.total === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500">
          {services.length === 0 ? "Gösterilecek hizmet yok." : "Sonuç bulunamadı"}
        </p>
      ) : null}
      {status === "ready" && result.total > 0 ? (
        <>
          <p className="px-4 pt-4 text-xs text-slate-500">
            {countFormatter.format(result.total)} sonuç · satış fiyatı / 1000 · sayfa{" "}
            {countFormatter.format(result.page)} / {countFormatter.format(result.pageCount)}
          </p>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Hizmet</th>
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Minimum</th>
                  <th className="px-4 py-3 font-medium">Maksimum</th>
                  <th className="px-4 py-3 font-medium">Satış fiyatı</th>
                  <th className="px-4 py-3 font-medium">Refill</th>
                  <th className="px-4 py-3 font-medium">Cancel</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((service) => (
                  <tr key={service.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{service.name}</p>
                      <p className="text-xs text-slate-500">{service.type}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{service.category}</td>
                    <td className="px-4 py-3 text-slate-700">{service.id}</td>
                    <td className="px-4 py-3 text-slate-700">{countFormatter.format(service.min)}</td>
                    <td className="px-4 py-3 text-slate-700">{countFormatter.format(service.max)}</td>
                    <td className="px-4 py-3 text-slate-900">{priceFormatter.format(service.salePrice)}</td>
                    <td className="px-4 py-3 text-slate-700">{service.refill ? "Var" : "Yok"}</td>
                    <td className="px-4 py-3 text-slate-700">{service.cancel ? "Var" : "Yok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-4 md:hidden">
            {result.items.map((service) => (
              <article key={service.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">{service.category}</p>
                    <h2 className="mt-1 text-sm font-semibold text-slate-950">{service.name}</h2>
                    <p className="text-xs text-slate-500">{service.type}</p>
                  </div>
                  <p className="text-xs font-medium text-slate-500">#{service.id}</p>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Field label="Minimum" value={countFormatter.format(service.min)} />
                  <Field label="Maksimum" value={countFormatter.format(service.max)} />
                  <Field label="Satış fiyatı" value={priceFormatter.format(service.salePrice)} />
                  <Field label="Refill" value={service.refill ? "Var" : "Yok"} />
                  <Field label="Cancel" value={service.cancel ? "Var" : "Yok"} />
                </dl>
              </article>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={result.page <= 1}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Önceki
            </button>
            <p className="text-sm text-slate-600">
              {countFormatter.format(result.page)} / {countFormatter.format(result.pageCount)}
            </p>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(result.pageCount, current + 1))}
              disabled={result.page >= result.pageCount}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function FlagSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: FlagFilter;
  onChange: (value: FlagFilter) => void;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700" htmlFor={id}>
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as FlagFilter)}
        className={fieldClass}
      >
        <option value="all">Tümü</option>
        <option value="yes">Var</option>
        <option value="no">Yok</option>
      </select>
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function ServiceSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {["one", "two", "three", "four"].map((item) => (
        <div key={item} className="h-14 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  );
}
