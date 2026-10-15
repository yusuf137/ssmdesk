import { AppError } from "@/lib/http/errors";
import type { OrderRecord, OrderRepository } from "@/lib/orders/repository";

export async function readOwnOrder(
  orders: OrderRepository,
  orderId: string,
  userId: string,
): Promise<OrderRecord> {
  const record = await orders.getForUser(orderId, userId);
  if (!record || record.userId !== userId) {
    throw new AppError("NOT_FOUND", 404, "Sipariş bulunamadı.");
  }
  return record;
}
