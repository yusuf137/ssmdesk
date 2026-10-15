import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { readAuthenticatedUser } from "@/lib/auth/session";

export default function HomePage() {
  return (
    <Suspense fallback={<p className="px-6 py-10 text-sm text-slate-500">Yönlendiriliyor…</p>}>
      <HomeGate />
    </Suspense>
  );
}

async function HomeGate() {
  try {
    await connection();
    const user = await readAuthenticatedUser();
    redirect(user ? "/dashboard" : "/login");
  } catch (error) {
    unstable_rethrow(error);
    redirect("/login");
  }
  return null;
}
