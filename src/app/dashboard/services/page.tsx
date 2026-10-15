import type { Metadata } from "next";

import { PageIntro } from "@/components/layout/page-intro";
import { ServiceBrowser } from "@/components/services/service-browser";

export const metadata: Metadata = {
  title: "Hizmetler",
};

export default function ServicesPage() {
  return (
    <PageIntro
      title="Hizmetler"
      description="Ada, kategoriye veya servis numarasına göre arayın. Listelenen tutar satış fiyatıdır."
    >
      <ServiceBrowser />
    </PageIntro>
  );
}
