"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api/browser";

const NAV = [
  { href: "/admin", label: "Genel Bakış" },
  { href: "/admin/orders", label: "Siparişler" },
  { href: "/admin/refills", label: "Refill" },
  { href: "/admin/cancellations", label: "İptaller" },
  { href: "/admin/users", label: "Kullanıcılar" },
  { href: "/admin/dealers", label: "Bayiler" },
  { href: "/admin/pricing", label: "Fiyatlandırma" },
  { href: "/admin/provider", label: "Provider" },
  { href: "/admin/audit", label: "Audit Logs" },
] as const;

function active(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await apiFetch("/api/auth/session", { method: "DELETE" });
    } finally {
      router.replace("/login");
      router.refresh();
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 bg-[#f4f6f8]">
      {open ? (
        <button
          type="button"
          aria-label="Menüyü kapat"
          className="fixed inset-0 z-30 bg-slate-950/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-950 text-slate-300 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-white/10 px-5 py-5">
          <p className="text-xs font-semibold tracking-[0.16em] text-teal-300 uppercase">Admin</p>
          <p className="mt-1 text-sm text-slate-400">Yönetim paneli</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="Admin">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(pathname, item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active(pathname, item.href) ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 md:hidden"
            onClick={() => setOpen((current) => !current)}
          >
            Menü
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">Admin</span>
            <Link href="/dashboard" className="text-sm font-semibold text-teal-700">
              Panele dön
            </Link>
            <p className="truncate text-sm font-medium text-slate-800">{email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={pending}
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending ? "Çıkılıyor…" : "Çıkış"}
          </button>
        </header>
        <div className="flex-1 px-4 py-6 md:px-8">{children}</div>
      </div>
    </div>
  );
}
