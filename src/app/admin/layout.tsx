import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { readAuthenticatedUser } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/admin-shell";
import { ConfigurationError } from "@/components/system/configuration-error";
import { AppError } from "@/lib/http/errors";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="px-6 py-8 text-sm text-slate-500">Yükleniyor…</p>}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

async function AdminGate({ children }: { children: ReactNode }) {
  await connection();
  const session = await readAdminSession();
  if (session.status === "config") return <ConfigurationError />;
  if (session.status === "guest") redirect("/login");
  if (session.status === "denied") notFound();
  return <AdminShell email={session.email}>{children}</AdminShell>;
}

async function readAdminSession(): Promise<
  { status: "config" } | { status: "guest" } | { status: "denied" } | { status: "admin"; email: string }
> {
  try {
    const user = await readAuthenticatedUser();
    if (!user) return { status: "guest" };
    if (user.role !== "admin") return { status: "denied" };
    return { status: "admin", email: user.email };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError && error.code === "CONFIG_ERROR") return { status: "config" };
    throw error;
  }
}
