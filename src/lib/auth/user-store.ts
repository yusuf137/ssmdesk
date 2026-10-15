import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { roleFromStored, type UserRole } from "@/lib/auth/roles";
import { COLLECTIONS } from "@/lib/constants";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { AppError } from "@/lib/http/errors";

export async function upsertUser(input: { uid: string; email: string }): Promise<void> {
  const db = getAdminFirestore();
  const ref = db.collection(COLLECTIONS.users).doc(input.uid);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      transaction.set(ref, {
        email: input.email,
        displayName: displayNameFromEmail(input.email),
        role: "user" satisfies UserRole,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    transaction.update(ref, {
      email: input.email,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function getUserRole(uid: string): Promise<UserRole> {
  const snapshot = await getAdminFirestore().collection(COLLECTIONS.users).doc(uid).get();
  if (!snapshot.exists) return "user";
  return roleFromStored(snapshot.get("role"));
}

export async function setAssignableUserRole(input: {
  actorId: string;
  targetId: string;
  role: "user" | "dealer";
}): Promise<void> {
  if (input.actorId === input.targetId) {
    throw new AppError("FORBIDDEN", 403, "Kendi rolünüz bu ekrandan değiştirilemez.");
  }
  const db = getAdminFirestore();
  const ref = db.collection(COLLECTIONS.users).doc(input.targetId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new AppError("NOT_FOUND", 404, "Kullanıcı bulunamadı.");
    }
    const current = snapshot.get("role");
    if (current === "admin") {
      throw new AppError("FORBIDDEN", 403, "Admin rolü bu ekrandan değiştirilemez.");
    }
    transaction.update(ref, {
      role: input.role,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  try {
    const auth = getAdminAuth();
    const account = await auth.getUser(input.targetId);
    await auth.setCustomUserClaims(input.targetId, { ...(account.customClaims ?? {}), role: input.role });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "role_claim_failed");
  }
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() ?? "";
  return local.slice(0, 80);
}
