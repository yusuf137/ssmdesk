import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { readAuthenticatedUser } from "@/lib/auth/session";
import { AuthScreen } from "@/components/auth/auth-screen";
import { CredentialsForm } from "@/components/auth/credentials-form";

export const metadata: Metadata = {
  title: "Kayıt",
};

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen title="Hesap oluştur" description="Yeni hesap yalnızca kullanıcı rolüyle açılır.">
          <p className="text-sm text-slate-500">Yükleniyor…</p>
        </AuthScreen>
      }
    >
      <RegisterGate />
    </Suspense>
  );
}

async function RegisterGate() {
  try {
    await connection();
    const user = await readAuthenticatedUser();
    if (user) redirect("/dashboard");
  } catch (error) {
    unstable_rethrow(error);
  }

  return (
    <AuthScreen title="Hesap oluştur" description="Yeni hesap yalnızca kullanıcı rolüyle açılır.">
      <CredentialsForm mode="register" />
    </AuthScreen>
  );
}
