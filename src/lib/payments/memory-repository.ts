import type { OrderAccess, OrderRecord } from "@/lib/orders/repository";
import type { PaymentRepository } from "@/lib/payments/repository";
import { decideCallback, decideSubmitClaim, type CallbackDecision, type PaymentRecord } from "@/lib/payments/record";
import { applyTopup } from "@/lib/wallet/apply";
import { topupLedgerId, type LedgerEntry, type WalletRecord } from "@/lib/wallet/types";

export class MemoryPaymentRepository implements PaymentRepository {
  readonly payments = new Map<string, PaymentRecord>();
  readonly orders = new Map<string, OrderRecord>();
  readonly wallets = new Map<string, WalletRecord>();
  readonly ledger = new Map<string, LedgerEntry>();
  private readonly tails = new Map<string, Promise<void>>();

  seed(order: OrderRecord): void {
    this.orders.set(order.id, order);
  }

  balance(userId: string): number {
    return this.wallets.get(userId)?.balanceMinor ?? 0;
  }

  async save(payment: PaymentRecord): Promise<void> {
    await this.exclusive(this.lockKey(payment), () => {
      this.payments.set(payment.merchantOid, payment);
    });
  }

  async markFailed(merchantOid: string, now: string): Promise<void> {
    const current = this.payments.get(merchantOid);
    if (!current || current.status === "succeeded") return;
    await this.exclusive(this.lockKey(current), () => {
      const latest = this.payments.get(merchantOid);
      if (!latest || latest.status === "succeeded") return;
      this.payments.set(merchantOid, { ...latest, status: "failed", updatedAt: now });
    });
  }

  async accessOrder(orderId: string, userId: string): Promise<OrderAccess> {
    const order = this.orders.get(orderId);
    if (!order) return { kind: "missing" };
    if (order.userId !== userId) return { kind: "foreign" };
    return { kind: "own", record: order };
  }

  async readOrder(orderId: string): Promise<OrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }

  async applyCallback(input: {
    merchantOid: string;
    outcome: "success" | "failed";
    paymentAmountMinor: number;
    totalAmountMinor: number;
    now: string;
  }): Promise<CallbackDecision> {
    const existing = this.payments.get(input.merchantOid);
    const lock = existing ? this.lockKey(existing) : input.merchantOid;
    return this.exclusive(lock, () => {
      const payment = this.payments.get(input.merchantOid) ?? null;
      if (payment?.type === "wallet_topup") {
        const next = applyTopup({
          payment,
          wallet: this.wallets.get(payment.userId) ?? null,
          ledger: this.ledger.get(topupLedgerId(payment.merchantOid)) ?? null,
          outcome: input.outcome,
          paymentAmountMinor: input.paymentAmountMinor,
          totalAmountMinor: input.totalAmountMinor,
          now: input.now,
        });
        if (next.kind === "credited") {
          this.payments.set(next.payment.merchantOid, next.payment);
          this.wallets.set(next.wallet.userId, next.wallet);
          this.ledger.set(next.ledger.id, next.ledger);
          return { type: "succeeded", orderId: null, purpose: "wallet_topup" } satisfies CallbackDecision;
        }
        if (next.kind === "failed") {
          this.payments.set(next.payment.merchantOid, next.payment);
          return { type: "failed", orderId: null, purpose: "wallet_topup" } satisfies CallbackDecision;
        }
        if (next.kind === "duplicate") {
          if (next.payment !== payment) this.payments.set(next.payment.merchantOid, next.payment);
          return { type: "duplicate", orderId: null, purpose: "wallet_topup" } satisfies CallbackDecision;
        }
        if (next.kind === "mismatch") return { type: "mismatch", orderId: null } satisfies CallbackDecision;
        return { type: "missing" } satisfies CallbackDecision;
      }
      const order = payment?.orderId ? (this.orders.get(payment.orderId) ?? null) : null;
      const next = decideCallback({
        payment,
        order,
        outcome: input.outcome,
        paymentAmountMinor: input.paymentAmountMinor,
        totalAmountMinor: input.totalAmountMinor,
        now: input.now,
      });
      if (next.payment && next.payment !== payment) this.payments.set(next.payment.merchantOid, next.payment);
      if (next.order && order && next.order !== order) this.orders.set(next.order.id, next.order);
      return next.decision;
    });
  }

  async claimPaidOrder(orderId: string, now: string): Promise<"claimed" | "duplicate" | "not_payable"> {
    return this.exclusive(orderId, () => {
      const next = decideSubmitClaim(this.orders.get(orderId) ?? null, now);
      if (next.order) this.orders.set(orderId, next.order);
      return next.result;
    });
  }

  private lockKey(payment: PaymentRecord): string {
    return payment.type === "wallet_topup" ? payment.userId : (payment.orderId ?? payment.merchantOid);
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
