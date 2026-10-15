import { ZodError } from "zod";

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  readonly internalMessage: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: string,
    status: number,
    publicMessage: string,
    internalMessage?: string,
    retryAfterSeconds?: number,
  ) {
    super(internalMessage ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.internalMessage = internalMessage;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RateLimitError extends AppError {
  readonly scope: string;

  constructor(scope: string, retryAfterSeconds: number, code = "TOO_MANY_REQUESTS") {
    super(
      code,
      429,
      "Çok fazla istek gönderildi. Lütfen bekleyin.",
      `rate_limit:${scope}`,
      retryAfterSeconds,
    );
    this.name = "RateLimitError";
    this.scope = scope;
  }
}

export class RateLimitStoreError extends AppError {
  readonly scope: string;

  constructor(scope: string) {
    super(
      "SERVICE_UNAVAILABLE",
      503,
      "İstek sınırı şu an doğrulanamıyor.",
      "rate_limit_store_unavailable",
      5,
    );
    this.name = "RateLimitStoreError";
    this.scope = scope;
  }
}

export type PublicErrorBody = {
  error: string;
  message: string;
  requestId: string;
};

const GENERIC_MESSAGE = "İşlem tamamlanamadı.";

export function toPublicError(
  error: unknown,
  requestId: string,
): { status: number; body: PublicErrorBody; retryAfterSeconds?: number } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
      body: {
        error: error.code,
        message: error.publicMessage,
        requestId,
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: "INVALID_REQUEST",
        message: "Gönderilen bilgiler geçersiz.",
        requestId,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "INTERNAL_ERROR",
      message: GENERIC_MESSAGE,
      requestId,
    },
  };
}

export function zodIssueSummary(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}:${issue.code}`);
}
