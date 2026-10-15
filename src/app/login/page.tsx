import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { readAuthenticatedUser } from "@/lib/auth/session";
import { AuthScreen } from "@/components/auth/auth-screen";
import { CredentialsForm } from "@/components/auth/credentials-form";

export const metadata: Metadata = {
  title: "Giriş",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen title="Giriş yap" description="Hesabınızla panele devam edin.">
          <p className="text-sm text-slate-500">Yükleniyor…</p>
        </AuthScreen>
      }
    >
      <LoginGate />
    </Suspense>
  );
}

async function LoginGate() {
  try {
    await connection();
    const user = await readAuthenticatedUser();
    if (user) redirect("/dashboard");
  } catch (error) {
    unstable_rethrow(error);
  }

  return (
    <AuthScreen title="Giriş yap" description="Hesabınızla panele devam edin.">
      <CredentialsForm mode="login" />
    </AuthScreen>
  );
}
