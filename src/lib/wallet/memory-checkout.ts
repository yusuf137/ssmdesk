import { AppError } from "@/lib/http/errors";
import { isOrderId, isViewerId, orderDocumentId } from "@/lib/orders/id";
import {
  pageOrders,
  type NewOrder,
  type OrderAccess,
  type OrderPage,
  type OrderRecord,
  type OrderRepository,
} from "@/lib/orders/repository";
import { applyOrderDebit, applyRefund, insufficientBalance } from "@/lib/wallet/apply";
import { pageLedger, toPublicLedger, type PublicLedgerEntry } from "@/lib/wallet/public";
import { refundReason } from "@/lib/wallet/profile";
import { debitLedgerId, refundLedgerId, type LedgerEntry, type WalletRecord } from "@/lib/wallet/types";

export class MemoryCheckout implements OrderRepository {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly costs = new Map<string, number>();
  private readonly wallets = new Map<string, WalletRecord>();
  private readonly ledger = new Map<string, LedgerEntry>();
  private readonly tails = new Map<string, Promise<void>>();

  fund(userId: string, balanceMinor: number, now = "2026-10-15T00:00:00.000Z"): void {
    if (!isViewerId(userId) || !Number.isSafeInteger(balanceMinor) || balanceMinor < 0) {
      throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    }
    const existing = this.wallets.get(userId);
    this.wallets.set(userId, {
      userId,
      balanceMinor,
      currency: "TRY",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  balance(userId: string): number {
    return this.wallets.get(userId)?.balanceMinor ?? 0;
  }

  getPublicWallet(userId: string): { balanceMinor: number; currency: "TRY" } {
    return { balanceMinor: this.balance(userId), currency: "TRY" };
  }

  ledgerCount(): number {
    return this.ledger.size;
  }

  listTransactions(userId: string, page: number): { transactions: PublicLedgerEntry[]; total: number; page: number; pageCount: number } {
    const records = [...this.ledger.values()]
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
    const listed = pageLedger(records, page);
    return {
      transactions: listed.entries.map((entry) => toPublicLedger(entry)),
      total: listed.total,
      page: listed.page,
      pageCount: listed.pageCount,
    };
  }

  seed(order: OrderRecord): void {
    this.orders.set(order.id, order);
  }

  async placePaidOrder(input: NewOrder, now = new Date().toISOString()): Promise<{ record: OrderRecord; created: boolean }> {
    const id = orderDocumentId(input.userId, input.idempotencyKey);
    return this.exclusive(input.userId, () => {
      const next = applyOrderDebit({
        existingOrder: this.orders.get(id) ?? null,
        existingLedger: this.ledger.get(debitLedgerId(id)) ?? null,
        wallet: this.wallets.get(input.userId) ?? null,
        draft: input,
        orderId: id,
        now,
      });
      if (next.kind === "foreign") throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
      if (next.kind === "conflict") {
        throw new AppError("INTERNAL_ERROR", 500, "İşlem tamamlanamadı.", "order_debit_conflict");
      }
      if (next.kind === "insufficient") throw insufficientBalance();
      if (next.kind === "replay") return { record: next.order, created: false };
      this.orders.set(next.order.id, next.order);
      this.costs.set(next.order.id, input.providerCostMinor);
      this.wallets.set(next.wallet.userId, next.wallet);
      this.ledger.set(next.ledger.id, next.ledger);
      return { record: next.order, created: true };
    });
  }

  async refundOrderToWallet(
    orderId: string,
    reason: string,
    now = new Date().toISOString(),
  ): Promise<"refunded" | "duplicate" | "not_refundable" | "missing"> {
    if (!refundReason(reason)) {
      throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
    }
    if (!isOrderId(orderId)) return "missing";
    const existing = this.orders.get(orderId);
    if (!existing) return "missing";
    return this.exclusive(existing.userId, () => {
      const order = this.orders.get(orderId) ?? null;
      const next = applyRefund({
        order,
        debit: order ? (this.ledger.get(debitLedgerId(order.id)) ?? null) : null,
        refund: order ? (this.ledger.get(refundLedgerId(order.id)) ?? null) : null,
        wallet: order ? (this.wallets.get(order.userId) ?? null) : null,
        now,
      });
      if (next.kind === "refunded") {
        this.orders.set(next.order.id, next.order);
        this.wallets.set(next.wallet.userId, next.wallet);
        this.ledger.set(next.ledger.id, next.ledger);
        return "refunded";
      }
      if (next.kind === "duplicate") {
        if (order && next.order.status !== order.status) this.orders.set(next.order.id, next.order);
        return "duplicate";
      }
      return next.kind;
    });
  }

  async createOrGet(input: NewOrder): Promise<{ record: OrderRecord; created: boolean }> {
    return this.placePaidOrder(input);
  }

  async listByUser(userId: string, page: number): Promise<OrderPage> {
    if (!isViewerId(userId)) return pageOrders([], page);
    const records = [...this.orders.values()]
      .filter((order) => order.userId === userId)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
    return pageOrders(records, page);
  }

  async accessForUser(orderId: string, userId: string): Promise<OrderAccess> {
    if (!isViewerId(userId) || !isOrderId(orderId)) return { kind: "missing" };
    const record = this.orders.get(orderId);
    if (!record) return { kind: "missing" };
    if (record.userId !== userId) return { kind: "foreign" };
    return { kind: "own", record };
  }

  async getForUser(orderId: string, userId: string): Promise<OrderRecord | null> {
    const access = await this.accessForUser(orderId, userId);
    return access.kind === "own" ? access.record : null;
  }

  readProviderCost(orderId: string): number | undefined {
    return this.costs.get(orderId);
  }

  size(): number {
    return this.orders.size;
  }

  private async exclusive<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(
      key,
      previous.then(() => gate),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
