import type { Metadata } from "next";

import { PageIntro } from "@/components/layout/page-intro";
import { NewOrderForm } from "@/components/orders/new-order-form";

export const metadata: Metadata = {
  title: "Yeni Sipariş",
};

export default function NewOrderPage() {
  return (
    <PageIntro
      title="Yeni sipariş"
      description="Sipariş bakiyeden düşülerek oluşturulur. Tutar sunucuda hesaplanır."
    >
      <NewOrderForm />
    </PageIntro>
  );
}
