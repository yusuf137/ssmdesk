import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { getUserRole, upsertUser } from "@/lib/auth/user-store";
import { canAccessAdmin, canManageDealerPricing, type UserRole } from "@/lib/auth/roles";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, SESSION_MAX_AGE_SECONDS } from "@/lib/constants";
import { getAdminAuth } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";

export type AuthenticatedUser = {
  uid: string;
  email: string;
  role: UserRole;
};

export const readAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => {
  await connection();
  const session = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!session) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    if (!decoded.uid || !decoded.email) return null;
    const role = await getUserRole(decoded.uid);
    return { uid: decoded.uid, email: decoded.email, role };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return null;
  }
});

export async function requireApiUser(): Promise<AuthenticatedUser> {
  const user = await readAuthenticatedUser();
  if (!user) {
    throw new AppError("UNAUTHENTICATED", 401, "Oturum doğrulanamadı.");
  }
  return user;
}

export async function getAuthenticatedRole(): Promise<UserRole | null> {
  const user = await readAuthenticatedUser();
  return user?.role ?? null;
}

export async function requireAdmin(): Promise<AuthenticatedUser> {
  const user = await requireApiUser();
  if (!canAccessAdmin(user.role)) {
    throw new AppError("FORBIDDEN", 403, "Bu işlem için yetkiniz yok.");
  }
  return user;
}

export async function requireDealerOrAdmin(): Promise<AuthenticatedUser> {
  const user = await requireApiUser();
  if (!canManageDealerPricing(user.role)) {
    throw new AppError("FORBIDDEN", 403, "Bu işlem için yetkiniz yok.");
  }
  return user;
}

export async function requireAdminUser(): Promise<AuthenticatedUser> {
  return requireAdmin();
}

export async function establishSession(idToken: string): Promise<AuthenticatedUser> {
  const auth = getAdminAuth();
  let decoded: Awaited<ReturnType<typeof auth.verifyIdToken>>;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    throw new AppError("AUTH_FAILED", 401, "Giriş tamamlanamadı.", "id_token_rejected");
  }

  if (!decoded.email) {
    throw new AppError("AUTH_FAILED", 401, "Giriş tamamlanamadı.", "email_missing");
  }

  let role: UserRole;
  try {
    await upsertUser({ uid: decoded.uid, email: decoded.email });
    role = await getUserRole(decoded.uid);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AUTH_FAILED", 401, "Giriş tamamlanamadı.", "user_profile_failed");
  }

  let sessionCookie: string;
  try {
    sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
  } catch {
    throw new AppError("AUTH_FAILED", 401, "Giriş tamamlanamadı.", "session_cookie_failed");
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return { uid: decoded.uid, email: decoded.email, role };
}

export async function clearSession(): Promise<void> {
  const user = await readAuthenticatedUser().catch(() => null);

  if (user) {
    try {
      await getAdminAuth().revokeRefreshTokens(user.uid);
    } catch {
      // The cookie is still cleared below.
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
