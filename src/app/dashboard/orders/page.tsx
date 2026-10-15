import type { Metadata } from "next";
import { Suspense } from "react";

import { PageIntro } from "@/components/layout/page-intro";
import { OrderList } from "@/components/orders/order-list";

export const metadata: Metadata = {
  title: "Siparişlerim",
};

export default function OrdersPage() {
  return (
    <PageIntro title="Siparişlerim" description="Yalnızca kendi siparişleriniz listelenir.">
      <Suspense fallback={<p className="text-sm text-slate-500">Yükleniyor…</p>}>
        <OrderList />
      </Suspense>
    </PageIntro>
  );
}
