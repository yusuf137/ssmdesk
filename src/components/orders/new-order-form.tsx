"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { formatTryLabel } from "@/lib/orders/money";
import { publicWalletSchema } from "@/lib/wallet/public";
import { calculateOrderPrice } from "@/lib/pricing/calculate-order-price";
import { publicOrderResponseSchema } from "@/lib/orders/public-order";
import { isPublicHttpUrl } from "@/lib/orders/schema";
import { publicCatalogSchema, type PublicService } from "@/lib/services/public-service";

const fieldClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20";

const unitFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const countFormatter = new Intl.NumberFormat("tr-TR");
const RESULT_LIMIT = 20;

function flagLabel(value: boolean): string {
  return value ? "Var" : "Yok";
}

export function NewOrderForm() {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const [services, setServices] = useState<PublicService[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PublicService | null>(null);
  const [link, setLink] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState(false);
  const [balanceMinor, setBalanceMinor] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setCatalogStatus("loading");
      setCatalogError(null);
      try {
        const response = await apiFetch("/api/services", { signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setCatalogStatus("error");
          setCatalogError(readPublicMessage(payload) ?? "Hizmet listesi alınamadı.");
          return;
        }
        const parsed = publicCatalogSchema.safeParse(payload);
        if (!parsed.success) {
          setCatalogStatus("error");
          setCatalogError("Hizmet listesi alınamadı.");
          return;
        }
        setServices(parsed.data.services);
        setCatalogStatus("ready");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setCatalogStatus("error");
        setCatalogError("Bağlantı kurulamadı.");
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey, router]);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/wallet", { signal: controller.signal })
      .then(async (response) => {
        const parsed = publicWalletSchema.safeParse(await response.json().catch(() => null));
        if (parsed.success) setBalanceMinor(parsed.data.balanceMinor);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (needle.length === 0) return [];
    return services
      .filter((service) => `${service.name} ${service.category} ${service.id}`.toLocaleLowerCase("tr").includes(needle))
      .slice(0, RESULT_LIMIT);
  }, [query, services]);

  const quantityValue = Number(quantity);
  const quantityIsInteger = Number.isInteger(quantityValue) && quantityValue > 0;
  const totalMinor =
    selected && quantityIsInteger ? calculateOrderPrice(quantityValue, selected.salePrice) : null;
  const quantityInRange =
    selected !== null && quantityIsInteger && quantityValue >= selected.min && quantityValue <= selected.max;

  function selectService(service: PublicService) {
    setSelected(service);
    setQuantity(String(service.min));
    setQuery("");
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    setInsufficient(false);

    if (!selected) {
      setError("Bir hizmet seçin.");
      return;
    }
    if (!isPublicHttpUrl(link.trim())) {
      setError("Link http veya https adresi olmalıdır.");
      return;
    }
    if (!quantityInRange || totalMinor === null) {
      setError("Adet, hizmetin minimum ve maksimum aralığında olmalıdır.");
      return;
    }

    submitting.current = true;
    setPending(true);
    let succeeded = false;
    try {
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      const response = await apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          serviceId: selected.id,
          targetUrl: link.trim(),
          quantity: quantityValue,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        const code =
          typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "";
        setInsufficient(code === "INSUFFICIENT_BALANCE");
        setError(readPublicMessage(payload) ?? "Sipariş oluşturulamadı.");
        return;
      }

      const parsed = publicOrderResponseSchema.safeParse(payload);
      if (!parsed.success) {
        setError("Sipariş oluşturulamadı.");
        return;
      }

      succeeded = true;
      idempotencyKey.current = null;
      router.push(`/dashboard/orders/${parsed.data.order.id}`);
    } catch {
      setError("Bağlantı kurulamadı.");
    } finally {
      if (!succeeded) {
        submitting.current = false;
        setPending(false);
      }
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label className="block text-sm font-medium text-slate-700" htmlFor="order-service-search">
          Hizmet
          <input
            id="order-service-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Hizmet adı, kategori veya ID"
            autoComplete="off"
            className={fieldClass}
          />
        </label>
        {catalogStatus === "loading" ? <p className="mt-3 text-sm text-slate-500">Hizmetler yükleniyor…</p> : null}
        {catalogStatus === "error" ? (
          <div className="mt-3">
            <p role="alert" className="text-sm text-rose-700">
              {catalogError}
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((current) => current + 1)}
              className="mt-3 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Tekrar dene
            </button>
          </div>
        ) : null}
        {catalogStatus === "ready" && query.trim().length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Seçmek için hizmet adı veya ID yazın.</p>
        ) : null}
        {catalogStatus === "ready" && query.trim().length > 0 && matches.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Sonuç bulunamadı</p>
        ) : null}
        {matches.length > 0 ? (
          <ul className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200">
            {matches.map((service) => (
              <li key={service.id} className="border-b border-slate-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() => selectService(service)}
                  className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                >
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{service.name}</span>
                    <span className="block text-xs text-slate-500">
                      {service.category} · #{service.id}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-600">{unitFormatter.format(service.salePrice)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="order-link">
          Link
          <input
            id="order-link"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={fieldClass}
          />
        </label>

        <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="order-quantity">
          Adet
          <input
            id="order-quantity"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="numeric"
            className={fieldClass}
          />
        </label>
        {selected ? (
          <p className="mt-2 text-xs text-slate-500">
            Minimum {countFormatter.format(selected.min)}, maksimum {countFormatter.format(selected.max)}
            {quantity.length > 0 && !quantityInRange ? " · adet bu aralıkta olmalı" : ""}
          </p>
        ) : null}

        {error ? (
          <div role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <p>{error}</p>
            {insufficient ? (
              <Link href="/dashboard/wallet" className="mt-2 inline-flex font-medium text-teal-800 hover:underline">
                Bakiye yükle
              </Link>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending || !selected}
          className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-slate-950 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? "Oluşturuluyor…" : "Sipariş oluştur"}
        </button>
      </section>

      <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {selected ? (
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Hizmet</dt>
              <dd className="mt-1 font-medium text-slate-950">{selected.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Kategori</dt>
              <dd className="mt-1 text-slate-900">{selected.category}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-slate-500">Minimum</dt>
                <dd className="mt-1 text-slate-900">{countFormatter.format(selected.min)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Maksimum</dt>
                <dd className="mt-1 text-slate-900">{countFormatter.format(selected.max)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Refill</dt>
                <dd className="mt-1 text-slate-900">{flagLabel(selected.refill)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Cancel</dt>
                <dd className="mt-1 text-slate-900">{flagLabel(selected.cancel)}</dd>
              </div>
            </div>
            <div>
              <dt className="text-slate-500">Satış fiyatı / 1000</dt>
              <dd className="mt-1 text-slate-900">{unitFormatter.format(selected.salePrice)} TRY</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-3">
              <dt className="text-slate-500">Toplam</dt>
              <dd className="mt-1 text-lg font-semibold text-slate-950">
                {totalMinor === null ? "—" : formatTryLabel(totalMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Bakiye</dt>
              <dd className="mt-1 text-slate-900">{balanceMinor === null ? "—" : formatTryLabel(balanceMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Sipariş sonrası</dt>
              <dd className="mt-1 text-slate-900">
                {balanceMinor === null || totalMinor === null
                  ? "—"
                  : balanceMinor < totalMinor
                    ? "Yetersiz bakiye. Bakiye yükleyin."
                    : formatTryLabel(balanceMinor - totalMinor)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Hizmet seçildiğinde fiyat ve limitler burada görünür.</p>
        )}
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Tutar ve bakiye sunucuda doğrulanır. Buradaki sipariş sonrası tutar yalnızca önizlemedir.
        </p>
      </aside>
    </form>
  );
}
