import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminConfig } from "@/lib/env/server";
import { AppError } from "@/lib/http/errors";

function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const config = getFirebaseAdminConfig();
  try {
    return initializeApp({
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
    });
  } catch {
    throw new AppError(
      "CONFIG_ERROR",
      503,
      "Kimlik doğrulama hizmeti kullanılamıyor.",
      "firebase_admin_init_failed",
    );
  }
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}
