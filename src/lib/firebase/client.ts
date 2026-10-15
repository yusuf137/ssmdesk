import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

import { readFirebasePublicConfig } from "@/lib/firebase/public-config";

let firebaseApp: FirebaseApp | null = null;

export function getFirebaseAuth(): Auth | null {
  const config = readFirebasePublicConfig();
  if (!config) return null;

  if (!firebaseApp) {
    firebaseApp = getApps()[0] ?? initializeApp(config);
  }

  return getAuth(firebaseApp);
}
