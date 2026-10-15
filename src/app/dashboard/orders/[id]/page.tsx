import type { Metadata } from "next";
import { Suspense } from "react";

import { OrderDetail } from "@/components/orders/order-detail";

export const metadata: Metadata = {
  title: "Sipariş",
};

export default function OrderDetailPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Yükleniyor…</p>}>
      <OrderDetail />
    </Suspense>
  );
}
