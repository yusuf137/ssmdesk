import "server-only";

import { z } from "zod";

import { AUTH_PROVIDER_TIMEOUT_MS, IDENTITY_TOOLKIT_ORIGIN } from "@/lib/constants";
import { getFirebaseWebApiKey } from "@/lib/env/server";
import { AppError, RateLimitError } from "@/lib/http/errors";

const tokenResponseSchema = z.object({
  idToken: z.string().min(1),
  localId: z.string().min(1),
  email: z.string().optional(),
});

const errorResponseSchema = z.object({
  error: z.object({
    message: z.string().optional(),
  }),
});

type IdentityAction = "signInWithPassword" | "signUp";

export type IdentityResult = {
  idToken: string;
  localId: string;
  email: string;
};

function providerErrorCode(payload: unknown): string | null {
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.error.message) return null;
  const code = parsed.data.error.message.split(" ")[0]?.replace(/:$/, "") ?? "";
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
}

async function callIdentityToolkit(
  action: IdentityAction,
  email: string,
  password: string,
): Promise<IdentityResult> {
  const url = new URL(`/v1/accounts:${action}`, IDENTITY_TOOLKIT_ORIGIN);
  url.searchParams.set("key", getFirebaseWebApiKey());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_PROVIDER_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new AppError("AUTH_UNAVAILABLE", 503, "Kimlik doğrulama hizmetine ulaşılamadı.", "identity_toolkit_network");
    }

    const text = await response.text();
    if (text.length > 100_000) {
      throw new AppError("AUTH_UNAVAILABLE", 503, "Kimlik doğrulama hizmetine ulaşılamadı.", "identity_toolkit_large_body");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new AppError("AUTH_UNAVAILABLE", 503, "Kimlik doğrulama hizmetine ulaşılamadı.", "identity_toolkit_invalid_json");
    }

    if (!response.ok) {
      const code = providerErrorCode(payload);
      if (code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
        throw new RateLimitError("identity_toolkit", 60);
      }

      const registration = action === "signUp";
      throw new AppError(
        registration ? "REGISTRATION_FAILED" : "INVALID_CREDENTIALS",
        registration ? 400 : 401,
        registration
          ? "Kayıt tamamlanamadı. Bilgileri kontrol edin."
          : "E-posta veya şifre hatalı.",
        code ? `identity_toolkit_${code}` : "identity_toolkit_rejected",
      );
    }

    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError("AUTH_UNAVAILABLE", 503, "Kimlik doğrulama hizmetine ulaşılamadı.", "identity_toolkit_unexpected_shape");
    }

    return {
      idToken: parsed.data.idToken,
      localId: parsed.data.localId,
      email: parsed.data.email ?? email,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function signInWithPassword(email: string, password: string): Promise<IdentityResult> {
  return callIdentityToolkit("signInWithPassword", email, password);
}

export function signUpWithPassword(email: string, password: string): Promise<IdentityResult> {
  return callIdentityToolkit("signUp", email, password);
}
