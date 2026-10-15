import { AppError } from "@/lib/http/errors";

export function readOrderListQuery(url: URL): number {
  if (url.searchParams.has("userId")) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }

  const raw = url.searchParams.get("page");
  if (raw === null || raw === "") return 1;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }

  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page > 10_000) {
    throw new AppError("INVALID_REQUEST", 400, "Gönderilen bilgiler geçersiz.");
  }
  return page;
}
