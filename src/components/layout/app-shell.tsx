"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import type { UserRole } from "@/lib/auth/roles";
import { apiFetch } from "@/lib/api/browser";
import { formatTryLabel } from "@/lib/orders/money";
import { publicWalletSchema } from "@/lib/wallet/public";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/wallet", label: "Bakiye" },
  { href: "/dashboard/services", label: "Hizmetler" },
  { href: "/dashboard/orders/new", label: "Yeni Sipariş" },
  { href: "/dashboard/orders", label: "Siparişlerim" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/orders") {
    return pathname === href || (pathname.startsWith(`${href}/`) && !pathname.startsWith("/dashboard/orders/new"));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShellFallback() {
  return (
    <div className="flex min-h-full flex-1 bg-[#f4f6f8]">
      <div className="hidden w-64 shrink-0 bg-slate-950 md:block" />
      <div className="flex-1 px-6 py-8">
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      </div>
    </div>
  );
}

export function AppShell({ email, role = "user", children }: { email: string; role?: UserRole; children: ReactNode }) {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <InteractiveShell email={email} role={role}>
        {children}
      </InteractiveShell>
    </Suspense>
  );
}

function HeaderBalance() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/wallet", { signal: controller.signal })
      .then(async (response) => {
        const parsed = publicWalletSchema.safeParse(await response.json().catch(() => null));
        if (parsed.success) setLabel(formatTryLabel(parsed.data.balanceMinor));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!label) return null;
  return (
    <Link href="/dashboard/wallet" className="truncate text-sm font-semibold text-slate-950">
      Bakiye: {label}
    </Link>
  );
}

function InteractiveShell({ email, role, children }: { email: string; role: UserRole; children: ReactNode }) {
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
          <p className="text-xs font-semibold tracking-[0.16em] text-teal-300 uppercase">SMM Panel</p>
          <p className="mt-1 text-sm text-slate-400">Hizmet kataloğu</p>
        </div>
        <nav id="panel-nav" className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="Panel">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 md:hidden"
            aria-expanded={open}
            aria-controls="panel-nav"
            onClick={() => setOpen((current) => !current)}
          >
            Menü
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
            <HeaderBalance />
            {role === "dealer" ? (
              <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800">Bayi</span>
            ) : null}
            {role === "admin" ? (
              <>
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">Admin</span>
                <Link href="/admin" className="text-sm font-semibold text-teal-700">
                  Admin Panel
                </Link>
              </>
            ) : null}
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
