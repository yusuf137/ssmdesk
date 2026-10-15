import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import type { UserRole } from "@/lib/auth/roles";
import { readAuthenticatedUser } from "@/lib/auth/session";
import { AppError } from "@/lib/http/errors";
import { AppShell, AppShellFallback } from "@/components/layout/app-shell";
import { ConfigurationError } from "@/components/system/configuration-error";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <AuthenticatedDashboard>{children}</AuthenticatedDashboard>
    </Suspense>
  );
}

async function AuthenticatedDashboard({ children }: { children: ReactNode }) {
  await connection();
  const session = await readDashboardSession();
  if (session.status === "config") return <ConfigurationError />;
  if (session.status === "guest") redirect("/login");
  return (
    <AppShell email={session.email} role={session.role}>
      {children}
    </AppShell>
  );
}

async function readDashboardSession(): Promise<
  { status: "config" } | { status: "guest" } | { status: "user"; email: string; role: UserRole }
> {
  try {
    const user = await readAuthenticatedUser();
    if (!user) return { status: "guest" };
    return { status: "user", email: user.email, role: user.role };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError && error.code === "CONFIG_ERROR") {
      return { status: "config" };
    }
    throw error;
  }
}
