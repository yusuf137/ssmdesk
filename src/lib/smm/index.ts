import "server-only";

import { smmFullProvider } from "@/lib/smmfull";
import type { SmmProvider } from "@/lib/smm/provider";

export function getSmmProvider(): SmmProvider {
  return smmFullProvider;
}
