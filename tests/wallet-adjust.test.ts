import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { walletAdjustSchema } from "../src/lib/admin/schema";
import { canAccessAdmin } from "../src/lib/auth/roles";
import { applyAdminAdjustment } from "../src/lib/wallet/adjust";
import { ledgerDocument, parseLedger } from "../src/lib/wallet/documents";
import { toPublicLedger } from "../src/lib/wallet/public";
import type { WalletRecord } from "../src/lib/wallet/types";

const root = join(import.meta.dirname, "..");
const target = "user-a";
const key = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-15T00:00:00.000Z";

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function wallet(balanceMinor: number): WalletRecord {
  return {
    userId: target,
    balanceMinor,
    currency: "TRY",
    createdAt: now,
    updatedAt: now,
  };
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) files.push(path);
  }
  return files;
}

test("user and dealer cannot adjust a wallet; admin can", () => {
  assert.equal(canAccessAdmin("user"), false);
  assert.equal(canAccessAdmin("dealer"), false);
  assert.equal(canAccessAdmin("admin"), true);
  const route = source("src/app/api/admin/users/[uid]/wallet-adjust/route.ts");
  const writer = source("src/lib/wallet/firestore-adjust.ts");
  assert.match(route, /requireAdmin\(/);
  assert.match(route, /userId: admin\.uid/);
  assert.match(route, /targetId: uid/);
  assert.match(route, /ADMIN_WALLET_ADJUSTED/);
  assert.equal(route.includes("firebase/firestore"), false);
  assert.match(writer, /runTransaction/);
  assert.match(writer, /transaction\.create/);
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: 10_000, reason: "Düzeltme", idempotencyKey: key, role: "admin" }).success, false);
  const rules = source("firestore.rules");
  const walletRule = rules.slice(rules.indexOf("match /wallets/"), rules.indexOf("match /walletTransactions/"));
  const ledgerRule = rules.slice(rules.indexOf("match /walletTransactions/"), rules.indexOf("match /pricingConfig/"));
  assert.match(walletRule, /allow read, write: if false/);
  assert.match(ledgerRule, /allow read, write: if false/);
  for (const file of walk(join(root, "src"))) {
    const path = relative(root, file).replaceAll("\\", "/");
    if (!source(path).includes("Bakiyeyi Düzenle")) continue;
    assert.equal(path.startsWith("src/app/admin/"), true, path);
  }
});

test("plus 100 TL credits the wallet and writes one ledger row", () => {
  const applied = applyAdminAdjustment({
    targetUserId: target,
    amountMinor: 10_000,
    reason: "Manuel ekleme",
    idempotencyKey: key,
    wallet: null,
    existing: null,
    now,
  });
  assert.equal(applied.kind, "applied");
  if (applied.kind !== "applied") return;
  assert.equal(applied.wallet.balanceMinor, 10_000);
  assert.equal(applied.ledger.type, "admin_adjustment");
  assert.equal(applied.ledger.amountMinor, 10_000);
  assert.equal(applied.ledger.balanceBeforeMinor, 0);
  assert.equal(applied.ledger.balanceAfterMinor, 10_000);
  assert.equal(applied.ledger.description, "Manuel ekleme");
  const stored = parseLedger(applied.ledger.id, ledgerDocument(applied.ledger));
  assert.ok(stored);
  assert.equal(toPublicLedger(applied.ledger).direction, "credit");
});

test("a negative adjustment debits and cannot pass below zero", () => {
  const debited = applyAdminAdjustment({
    targetUserId: target,
    amountMinor: -5_000,
    reason: "Manuel düşüm",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    wallet: wallet(10_000),
    existing: null,
    now,
  });
  assert.equal(debited.kind, "applied");
  if (debited.kind !== "applied") return;
  assert.equal(debited.wallet.balanceMinor, 5_000);
  assert.equal(debited.ledger.amountMinor, 5_000);
  assert.equal(debited.ledger.balanceBeforeMinor, 10_000);
  assert.equal(debited.ledger.balanceAfterMinor, 5_000);
  assert.equal(toPublicLedger(debited.ledger).direction, "debit");

  const rejected = applyAdminAdjustment({
    targetUserId: target,
    amountMinor: -1,
    reason: "Eksik bakiye",
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    wallet: wallet(0),
    existing: null,
    now,
  });
  assert.equal(rejected.kind, "insufficient");
});

test("the same idempotency key does not adjust twice", () => {
  const first = applyAdminAdjustment({
    targetUserId: target,
    amountMinor: 10_000,
    reason: "Manuel ekleme",
    idempotencyKey: key,
    wallet: null,
    existing: null,
    now,
  });
  assert.equal(first.kind, "applied");
  if (first.kind !== "applied") return;
  const second = applyAdminAdjustment({
    targetUserId: target,
    amountMinor: 10_000,
    reason: "Manuel ekleme",
    idempotencyKey: key,
    wallet: first.wallet,
    existing: first.ledger,
    now,
  });
  assert.equal(second.kind, "duplicate");
  if (second.kind !== "duplicate") return;
  assert.equal(second.wallet.balanceMinor, 10_000);
  assert.equal(second.ledger.id, first.ledger.id);
  const changed = applyAdminAdjustment({
    targetUserId: target,
    amountMinor: -5_000,
    reason: "Manuel ekleme",
    idempotencyKey: key,
    wallet: first.wallet,
    existing: first.ledger,
    now,
  });
  assert.equal(changed.kind, "conflict");
});

test("wallet adjustment body accepts only an integer amount, a reason, and an idempotency key", () => {
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: 10_000, reason: "Düzeltme", idempotencyKey: key }).success, true);
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: -5_000, reason: "Düzeltme", idempotencyKey: key }).success, true);
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: 0, reason: "Düzeltme", idempotencyKey: key }).success, false);
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: 10.5, reason: "Düzeltme", idempotencyKey: key }).success, false);
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: "10000", reason: "Düzeltme", idempotencyKey: key }).success, false);
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: 10_000, reason: "  ", idempotencyKey: key }).success, false);
  assert.equal(walletAdjustSchema.safeParse({ amountMinor: 10_000, reason: "Düzeltme" }).success, false);
});
