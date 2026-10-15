import { Suspense } from "react";

import { PaymentResult } from "@/components/payments/payment-result";

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<p className="px-4 py-16 text-sm text-slate-500">Yükleniyor…</p>}>
      <PaymentResult page="success" />
    </Suspense>
  );
}
