import type { Metadata } from "next";

import { PageIntro } from "@/components/layout/page-intro";
import { ServiceBrowser } from "@/components/services/service-browser";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <PageIntro
      title="Dashboard"
      description="Satışa açık hizmetler. Fiyatlar 1000 adet içindir ve sağlayıcı maliyeti gösterilmez."
    >
      <ServiceBrowser />
    </PageIntro>
  );
}
