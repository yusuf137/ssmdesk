import { AppError } from "@/lib/http/errors";

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("INVALID_REQUEST", 400, "İstek biçimi geçersiz.");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new AppError("INVALID_REQUEST", 400, "İstek çok büyük.");
  }

  if (!request.body) {
    throw new AppError("INVALID_REQUEST", 400, "İstek gövdesi eksik.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError("INVALID_REQUEST", 400, "İstek çok büyük.");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader was already cancelled after the size limit.
    }
  }

  const text = new TextDecoder().decode(concatBytes(chunks));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("INVALID_REQUEST", 400, "İstek biçimi geçersiz.");
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
