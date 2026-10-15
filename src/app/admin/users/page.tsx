"use client";

import { useEffect, useRef, useState } from "react";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { formatTryLabel } from "@/lib/orders/money";
import { parseTryInputToMinor } from "@/lib/wallet/amount";

type ListedUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string;
  createdAt: string | null;
};

function parseSignedTry(value: string): number | null {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const body = trimmed.replace(/^[+-]/, "");
  const minor = parseTryInputToMinor(body);
  if (minor === null || minor === 0) return null;
  return negative ? -minor : minor;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const adjustmentKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/admin/users", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Kullanıcılar alınamadı.");
          return;
        }
        setError(null);
        setUsers(Array.isArray(body?.users) ? body.users : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [version]);

  async function changeRole(uid: string, role: "user" | "dealer") {
    setPending(uid);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/role`, {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readPublicMessage(body) ?? "Rol güncellenemedi.");
        return;
      }
      setVersion((current) => current + 1);
    } finally {
      setPending(null);
    }
  }

  async function adjustBalance(uid: string) {
    const amountMinor = parseSignedTry(amount);
    const trimmed = reason.trim();
    if (amountMinor === null) {
      setError("Tutar geçersiz. Örnek: +100 veya -50.");
      return;
    }
    if (trimmed.length < 3) {
      setError("Açıklama zorunlu.");
      return;
    }
    setPending(uid);
    setError(null);
    setNotice(null);
    adjustmentKeys.current[uid] ??= crypto.randomUUID();
    try {
      const response = await apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/wallet-adjust`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor,
          reason: trimmed,
          idempotencyKey: adjustmentKeys.current[uid],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readPublicMessage(body) ?? "Bakiye güncellenemedi.");
        return;
      }
      delete adjustmentKeys.current[uid];
      const balance = typeof body?.balanceMinor === "number" ? formatTryLabel(body.balanceMinor) : null;
      setNotice(
        body?.duplicate === true
          ? "Bu işlem daha önce uygulanmış."
          : balance
            ? `Yeni bakiye: ${balance}`
            : "Bakiye güncellendi.",
      );
      setAmount("");
      setReason("");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Kullanıcılar</h1>
        <p className="mt-1 text-sm text-slate-500">Admin rolü bu ekrandan atanamaz.</p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="text-sm text-teal-800">{notice}</p> : null}
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {users.map((user) => (
          <li key={user.uid} className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-950">{user.email ?? user.uid}</p>
                <p className="text-xs text-slate-500">
                  {user.displayName ?? "İsimsiz"} · {user.role}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpenUid((current) => (current === user.uid ? null : user.uid));
                    setAmount("");
                    setReason("");
                    setError(null);
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  Bakiyeyi Düzenle
                </button>
                {user.role === "admin" ? (
                  <span className="px-2 py-2 text-xs font-semibold text-slate-500">Admin</span>
                ) : (
                  <button
                    type="button"
                    disabled={pending === user.uid}
                    onClick={() => void changeRole(user.uid, user.role === "dealer" ? "user" : "dealer")}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
                  >
                    {user.role === "dealer" ? "Kullanıcı yap" : "Bayi yap"}
                  </button>
                )}
              </div>
            </div>
            {openUid === user.uid ? (
              <form
                className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void adjustBalance(user.uid);
                }}
              >
                <label className="text-xs font-medium text-slate-600">
                  Tutar
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="+100 veya -50"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Açıklama
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={120}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950"
                  />
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAmount("+100")}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                  >
                    +100 TL
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmount("-50")}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                  >
                    -50 TL
                  </button>
                  <button
                    type="submit"
                    disabled={pending === user.uid}
                    className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Uygula
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
