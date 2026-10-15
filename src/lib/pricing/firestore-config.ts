import "server-only";

import type { PricingUpdate } from "@/lib/admin/schema";
import type { PricingRole, UserRole } from "@/lib/auth/roles";
import { COLLECTIONS } from "@/lib/constants";
import {
  getDealerPriceMultiplier,
  getSalePriceMultiplier,
  getUserPriceMultiplier,
} from "@/lib/env/server";
import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import type { CategoryRoleMultiplier, RoleMultiplierConfig, ServiceRoleOverride } from "@/lib/pricing/role-price";
import { resolveRolePrice, type ResolvedRolePrice } from "@/lib/pricing/role-price";

export type PricingSnapshot = {
  global: RoleMultiplierConfig;
  categories: Map<string, CategoryRoleMultiplier>;
  services: Map<number, ServiceRoleOverride>;
  fallbackMultiplier: number;
};

function readMultiplier(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readMinor(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function loadPricingSnapshot(): Promise<PricingSnapshot> {
  const fallbackMultiplier = getSalePriceMultiplier();
  const global: RoleMultiplierConfig = {
    userMultiplier: getUserPriceMultiplier(),
    dealerMultiplier: getDealerPriceMultiplier(),
    minimumProfitMinor: 0,
  };
  const categories = new Map<string, CategoryRoleMultiplier>();
  const services = new Map<number, ServiceRoleOverride>();
  const database = getAdminFirestore();

  const [configSnap, legacySnap, overrideSnap] = await Promise.all([
    database.collection(COLLECTIONS.pricingConfig).doc("global").get(),
    database.collection(COLLECTIONS.services).get(),
    database.collection(COLLECTIONS.pricingOverrides).get(),
  ]);

  if (configSnap.exists) {
    const userMultiplier = readMultiplier(configSnap.get("userMultiplier"));
    const dealerMultiplier = readMultiplier(configSnap.get("dealerMultiplier"));
    const minimum = configSnap.get("minimumProfitMinor");
    if (userMultiplier !== null) global.userMultiplier = userMultiplier;
    if (dealerMultiplier !== null) global.dealerMultiplier = dealerMultiplier;
    if (typeof minimum === "number" && Number.isSafeInteger(minimum) && minimum >= 0) {
      global.minimumProfitMinor = minimum;
    }
    const rawCategories = configSnap.get("categories");
    if (rawCategories && typeof rawCategories === "object" && !Array.isArray(rawCategories)) {
      for (const [category, value] of Object.entries(rawCategories)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const record = value as Record<string, unknown>;
        categories.set(category, {
          userMultiplier: readMultiplier(record.userMultiplier),
          dealerMultiplier: readMultiplier(record.dealerMultiplier),
        });
      }
    }
  }

  for (const document of legacySnap.docs) {
    const id = Number(document.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const salePrice = document.get("salePrice");
    services.set(id, {
      enabled: document.get("enabled") !== false,
      fixedSalePrice: typeof salePrice === "number" && Number.isFinite(salePrice) && salePrice > 0 ? salePrice : null,
      userFixedRateMinor: null,
      dealerFixedRateMinor: null,
      userMultiplier: null,
      dealerMultiplier: null,
    });
  }

  for (const document of overrideSnap.docs) {
    const id = Number(document.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const current = services.get(id) ?? {
      enabled: true,
      fixedSalePrice: null,
      userFixedRateMinor: null,
      dealerFixedRateMinor: null,
      userMultiplier: null,
      dealerMultiplier: null,
    };
    if (document.get("enabled") !== false) {
      current.userFixedRateMinor = readMinor(document.get("userFixedRateMinor"));
      current.dealerFixedRateMinor = readMinor(document.get("dealerFixedRateMinor"));
      current.userMultiplier = readMultiplier(document.get("userMultiplier"));
      current.dealerMultiplier = readMultiplier(document.get("dealerMultiplier"));
    }
    services.set(id, current);
  }

  return { global, categories, services, fallbackMultiplier };
}

export function priceForRole(
  snapshot: PricingSnapshot,
  role: UserRole,
  input: { costPrice: number; category: string; serviceId: number },
): ResolvedRolePrice | null {
  const pricingRole: PricingRole = role === "dealer" ? "dealer" : "user";
  const service = snapshot.services.get(input.serviceId) ?? null;
  if (service && !service.enabled) return null;
  return resolveRolePrice({
    role: pricingRole,
    costPrice: input.costPrice,
    fallbackMultiplier: snapshot.fallbackMultiplier,
    global: snapshot.global,
    service,
    category: snapshot.categories.get(input.category) ?? null,
  });
}

export async function savePricingUpdate(input: PricingUpdate): Promise<void> {
  const database = getAdminFirestore();
  const globalRef = database.collection(COLLECTIONS.pricingConfig).doc("global");
  if (input.type === "global") {
    await globalRef.set(
      {
        userMultiplier: input.userMultiplier,
        dealerMultiplier: input.dealerMultiplier,
        minimumProfitMinor: input.minimumProfitMinor,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  if (input.type === "service") {
    await database
      .collection(COLLECTIONS.pricingOverrides)
      .doc(String(input.serviceId))
      .set({
        enabled: input.enabled,
        userFixedRateMinor: input.userFixedRateMinor,
        dealerFixedRateMinor: input.dealerFixedRateMinor,
        userMultiplier: input.userMultiplier,
        dealerMultiplier: input.dealerMultiplier,
        updatedAt: FieldValue.serverTimestamp(),
      });
    return;
  }

  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(globalRef);
    const current = snapshot.get("categories");
    const categories =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
    categories[input.category] = {
      userMultiplier: input.userMultiplier,
      dealerMultiplier: input.dealerMultiplier,
    };
    transaction.set(
      globalRef,
      { categories, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
}
