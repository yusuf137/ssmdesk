"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { formatTryLabel } from "@/lib/orders/money";
import { initPaymentResponseSchema } from "@/lib/payments/schema";
import { publicBillingResponseSchema } from "@/lib/wallet/profile";
import { parseTryInputToMinor } from "@/lib/wallet/amount";
import { publicLedgerPageSchema, publicWalletSchema, type PublicLedgerEntry } from "@/lib/wallet/public";
import { MAX_CUSTOM_TOPUP_MINOR, MIN_CUSTOM_TOPUP_MINOR, TOPUP_PACKAGES, type TopupPackageId } from "@/lib/wallet/types";

const fieldClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20";

function movementLabel(entry: PublicLedgerEntry): string {
  if (entry.type === "order_debit" && entry.orderId) return `Sipariş #${entry.orderId.slice(0, 8)}`;
  return entry.description;
}

function movementSign(entry: PublicLedgerEntry): string {
  if (entry.type === "order_debit" || entry.direction === "debit") return "−";
  return "+";
}

export function WalletPanel() {
  const router = useRouter();
  const [balanceMinor, setBalanceMinor] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<PublicLedgerEntry[]>([]);
  const [profileReady, setProfileReady] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [startedBalance, setStartedBalance] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  const reload = useCallback(async () => {
    const [walletResponse, movementResponse, profileResponse] = await Promise.all([
      apiFetch("/api/wallet"),
      apiFetch("/api/wallet/transactions"),
      apiFetch("/api/wallet/profile"),
    ]);
    if (walletResponse.status === 401 || movementResponse.status === 401 || profileResponse.status === 401) {
      router.replace("/login");
      return;
    }
    const wallet = publicWalletSchema.safeParse(await walletResponse.json().catch(() => null));
    const movements = publicLedgerPageSchema.safeParse(await movementResponse.json().catch(() => null));
    const profile = publicBillingResponseSchema.safeParse(await profileResponse.json().catch(() => null));
    if (!wallet.success || !movements.success || !profile.success) {
      setError("Bakiye bilgisi alınamadı.");
      return;
    }
    setBalanceMinor(wallet.data.balanceMinor);
    setTransactions(movements.data.transactions);
    setProfileReady(profile.data.profile !== null);
    if (profile.data.profile) {
      setFullName(profile.data.profile.fullName);
      setPhone(profile.data.profile.phone);
      setAddress(profile.data.profile.address);
    }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [walletResponse, movementResponse, profileResponse] = await Promise.all([
          apiFetch("/api/wallet", { signal: controller.signal }),
          apiFetch("/api/wallet/transactions", { signal: controller.signal }),
          apiFetch("/api/wallet/profile", { signal: controller.signal }),
        ]);
        if (walletResponse.status === 401 || movementResponse.status === 401 || profileResponse.status === 401) {
          router.replace("/login");
          return;
        }
        const wallet = publicWalletSchema.safeParse(await walletResponse.json().catch(() => null));
        const movements = publicLedgerPageSchema.safeParse(await movementResponse.json().catch(() => null));
        const profile = publicBillingResponseSchema.safeParse(await profileResponse.json().catch(() => null));
        if (!wallet.success || !movements.success || !profile.success) {
          setError("Bakiye bilgisi alınamadı.");
          return;
        }
        setBalanceMinor(wallet.data.balanceMinor);
        setTransactions(movements.data.transactions);
        setProfileReady(profile.data.profile !== null);
        if (profile.data.profile) {
          setFullName(profile.data.profile.fullName);
          setPhone(profile.data.profile.phone);
          setAddress(profile.data.profile.address);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError("Bağlantı kurulamadı.");
      }
    }
    void load();
    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    if (!iframeUrl || startedBalance === null) return;
    const timer = window.setInterval(() => {
      void apiFetch("/api/wallet")
        .then(async (response) => {
          const parsed = publicWalletSchema.safeParse(await response.json().catch(() => null));
          if (!parsed.success || parsed.data.balanceMinor === startedBalance) return;
          window.clearInterval(timer);
          setIframeUrl(null);
          await reload();
        })
        .catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [iframeUrl, reload, startedBalance]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiFetch("/api/wallet/profile", {
        method: "POST",
        body: JSON.stringify({ fullName, phone, address }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = publicBillingResponseSchema.safeParse(payload);
      if (!response.ok || !parsed.success || !parsed.data.profile) {
        setError(readPublicMessage(payload) ?? "Bilgiler kaydedilemedi.");
        return;
      }
      setProfileReady(true);
    } catch {
      setError("Bağlantı kurulamadı.");
    } finally {
      setPending(false);
    }
  }

  async function beginTopup(body: { packageId: TopupPackageId } | { customAmountMinor: number }) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiFetch("/api/wallet/topup/paytr/init", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = initPaymentResponseSchema.safeParse(payload);
      if (!response.ok || !parsed.success) {
        setError(readPublicMessage(payload) ?? "Bakiye yükleme başlatılamadı.");
        return;
      }
      setStartedBalance(balanceMinor);
      setIframeUrl(parsed.data.iframeUrl);
    } catch {
      setError("Bağlantı kurulamadı.");
    } finally {
      setPending(false);
    }
  }

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const minor = parseTryInputToMinor(customAmount);
    if (minor === null) {
      setError("Geçerli bir tutar girin.");
      return;
    }
    if (minor < MIN_CUSTOM_TOPUP_MINOR) {
      setError("Minimum bakiye yükleme tutarı 50 TL.");
      return;
    }
    if (minor > MAX_CUSTOM_TOPUP_MINOR) {
      setError("Maksimum bakiye yükleme tutarı 20.000 TL.");
      return;
    }
    void beginTopup({ customAmountMinor: minor });
  }

  const customPreview = parseTryInputToMinor(customAmount);

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <p className="text-sm text-slate-500">Mevcut Bakiye</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          {balanceMinor === null ? "—" : formatTryLabel(balanceMinor)}
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-slate-950">Bakiye Yükle</h2>
        {profileReady ? null : (
          <form onSubmit={saveProfile} className="mt-4 grid gap-4">
            <p className="text-sm text-slate-600">İlk yüklemeden önce ad soyad, telefon ve adres gerekir.</p>
            <label className="text-sm font-medium text-slate-700" htmlFor="billing-name">
              Ad soyad
              <input id="billing-name" value={fullName} onChange={(event) => setFullName(event.target.value)} className={fieldClass} autoComplete="name" />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="billing-phone">
              Telefon
              <input id="billing-phone" value={phone} onChange={(event) => setPhone(event.target.value)} className={fieldClass} autoComplete="tel" inputMode="tel" />
            </label>
            <label className="text-sm font-medium text-slate-700" htmlFor="billing-address">
              Adres
              <textarea id="billing-address" value={address} onChange={(event) => setAddress(event.target.value)} className={fieldClass} rows={3} autoComplete="street-address" />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              {pending ? "Kaydediliyor…" : "Bilgileri kaydet"}
            </button>
          </form>
        )}
        {profileReady && iframeUrl ? (
          <iframe title="PayTR bakiye yükleme" src={iframeUrl} className="mt-4 h-[640px] w-full rounded-xl border border-slate-200" />
        ) : null}
        {profileReady && !iframeUrl ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TOPUP_PACKAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={pending}
                onClick={() => void beginTopup({ packageId: item.id })}
                className="flex h-12 items-center justify-center rounded-xl border border-slate-300 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {profileReady && !iframeUrl ? (
          <form onSubmit={submitCustom} className="mt-6 border-t border-slate-100 pt-6">
            <h3 className="text-sm font-semibold text-slate-950">Özel Tutar</h3>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-sm font-medium text-slate-700" htmlFor="custom-topup">
                Tutar
                <span className="mt-1 flex items-center rounded-xl border border-slate-300 bg-white focus-within:border-teal-700 focus-within:ring-2 focus-within:ring-teal-700/20">
                  <input
                    id="custom-topup"
                    value={customAmount}
                    onChange={(event) => setCustomAmount(event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="250,00"
                    className="w-full bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none"
                  />
                  <span className="pr-3 text-sm text-slate-500">TL</span>
                </span>
              </label>
              <button
                type="submit"
                disabled={pending}
                className="flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                Bakiye Yükle
              </button>
            </div>
            {customPreview !== null ? (
              <p className="mt-2 text-sm font-medium text-slate-800">{formatTryLabel(customPreview)}</p>
            ) : null}
          </form>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Yönlendirme bakiyenin yüklendiğini göstermez. Paket tutarı sunucuda seçilir; özel tutar kuruş olarak doğrulanır.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-slate-950">Son hareketler</h2>
        {transactions.length === 0 ? <p className="mt-3 text-sm text-slate-500">Henüz hareket yok.</p> : null}
        <ul className="mt-3 divide-y divide-slate-100">
          {transactions.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="text-slate-700">{movementLabel(entry)}</span>
              <span className={entry.type === "order_debit" ? "font-medium text-rose-700" : "font-medium text-teal-800"}>
                {movementSign(entry)} {formatTryLabel(entry.amountMinor)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
