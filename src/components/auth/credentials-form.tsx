"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";

type AuthMode = "login" | "register";

const copy: Record<
  AuthMode,
  { action: string; href: string; prompt: string; submit: string; pending: string }
> = {
  login: {
    action: "/api/auth/login",
    href: "/register",
    prompt: "Hesabınız yok mu?",
    submit: "Giriş yap",
    pending: "Giriş yapılıyor…",
  },
  register: {
    action: "/api/auth/register",
    href: "/login",
    prompt: "Zaten hesabınız var mı?",
    submit: "Hesap oluştur",
    pending: "Hesap oluşturuluyor…",
  },
};

export function CredentialsForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const text = copy[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (mode === "register" && !isAcceptablePassword(password)) {
      setError("Şifre en az 8 karakter olmalı ve harf ile rakam içermelidir.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await apiFetch(text.action, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readPublicMessage(payload) ?? "İşlem tamamlanamadı.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Bağlantı kurulamadı.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <label className="block text-sm font-medium text-slate-700" htmlFor={`${mode}-email`}>
        E-posta
        <input
          id={`${mode}-email`}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
        />
      </label>
      <label className="block text-sm font-medium text-slate-700" htmlFor={`${mode}-password`}>
        Şifre
        <input
          id={`${mode}-password`}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "register" ? PASSWORD_MIN_LENGTH : 1}
          maxLength={PASSWORD_MAX_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
        />
      </label>
      {mode === "register" ? (
        <p className="text-xs leading-5 text-slate-500">
          En az 8 karakter, bir harf ve bir rakam. Şifre sunucu kayıtlarında tutulmaz.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="flex h-11 w-full items-center justify-center rounded-xl bg-slate-950 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {pending ? text.pending : text.submit}
      </button>
      <p className="text-sm text-slate-600">
        {text.prompt}{" "}
        <Link href={text.href} className="font-medium text-teal-800 hover:text-teal-950">
          {mode === "login" ? "Kayıt ol" : "Giriş yap"}
        </Link>
      </p>
    </form>
  );
}

function isAcceptablePassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}
