import type { Metadata } from "next";

import { PageIntro } from "@/components/layout/page-intro";
import { WalletPanel } from "@/components/wallet/wallet-panel";

export const metadata: Metadata = {
  title: "Bakiye",
};

export default function WalletPage() {
  return (
    <PageIntro title="Bakiye" description="Bakiye yükleyin, hareketleri görün ve siparişi bakiyeden oluşturun.">
      <WalletPanel />
    </PageIntro>
  );
}
