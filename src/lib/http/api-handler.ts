import "server-only";

import { unstable_rethrow } from "next/navigation";
import { connection, NextResponse } from "next/server";
import { ZodError } from "zod";

import { CSRF_HEADER, CSRF_HEADER_VALUE, REQUEST_ID_HEADER } from "@/lib/constants";
import { AppError, RateLimitError, RateLimitStoreError, toPublicError, zodIssueSummary } from "@/lib/http/errors";
import { assertAllowedOrigin } from "@/lib/http/origin";
import { setRateLimitStoreErrorReporter } from "@/lib/http/rate-limit";
import { resolveRequestId } from "@/lib/http/request-id";
import { writeAuditLog } from "@/lib/logging/audit";
import { logError, logInfo, logWarn } from "@/lib/logging/logger";

export type ApiContext = {
  request: Request;
  requestId: string;
  endpoint: string;
  setUserId: (userId: string) => void;
};

setRateLimitStoreErrorReporter((info) => {
  logWarn("RATE_LIMIT_STORE_ERROR", { scope: info.scope, fallback: true });
});

function assertCsrf(request: Request): void {
  if (request.headers.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw new AppError("FORBIDDEN_ORIGIN", 403, "İstek reddedildi.");
  }
}

function applyResponseHeaders(response: NextResponse, requestId: string, retryAfterSeconds?: number): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (retryAfterSeconds !== undefined) {
    response.headers.set("Retry-After", String(retryAfterSeconds));
  }
  return response;
}

export function withApi(
  handler: (context: ApiContext) => Promise<NextResponse>,
  options: { mutation: boolean },
) {
  return async (request: Request): Promise<NextResponse> => {
    await connection();
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const endpoint = new URL(request.url).pathname;
    const started = Date.now();
    let status = 500;
    let userId: string | undefined;
    let errorCode: string | null = null;

    try {
      assertAllowedOrigin(request);
      if (options.mutation) assertCsrf(request);

      const response = await handler({
        request,
        requestId,
        endpoint,
        setUserId: (id) => {
          userId = id;
        },
      });
      status = response.status;
      return applyResponseHeaders(response, requestId);
    } catch (error) {
      unstable_rethrow(error);
      const mapped = toPublicError(error, requestId);
      status = mapped.status;

      if (error instanceof ZodError) {
        errorCode = "INVALID_REQUEST";
        logWarn("invalid_request", {
          requestId,
          endpoint,
          issues: zodIssueSummary(error),
        });
      } else if (
        error instanceof AppError &&
        !(error instanceof RateLimitError) &&
        !(error instanceof RateLimitStoreError)
      ) {
        errorCode = error.code;
        logWarn("api_error", {
          requestId,
          endpoint,
          code: error.code,
          detail: error.internalMessage ?? error.code,
        });
      } else {
        errorCode = "INTERNAL_ERROR";
        logError("unhandled_api_error", {
          requestId,
          endpoint,
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "unknown",
        });
      }

      if (error instanceof RateLimitStoreError) {
        errorCode = error.code;
        logWarn("RATE_LIMIT_STORE_ERROR", {
          requestId,
          endpoint,
          scope: error.scope,
          fallback: false,
        });
        await writeAuditLog({
          action: "RATE_LIMIT_STORE_ERROR",
          requestId,
          endpoint,
          outcome: "failure",
          userId,
          metadata: { scope: error.scope },
        });
      } else if (error instanceof RateLimitError) {
        errorCode = error.code;
        logWarn("RATE_LIMIT_HIT", {
          requestId,
          endpoint,
          scope: error.scope,
          retryAfterSeconds: error.retryAfterSeconds ?? 0,
        });
        await writeAuditLog({
          action: "RATE_LIMIT_HIT",
          requestId,
          endpoint,
          outcome: "failure",
          userId,
          metadata: {
            scope: error.scope,
            retryAfterSeconds: error.retryAfterSeconds ?? 0,
          },
        });
      } else if (
        error instanceof AppError &&
        (error.code === "INVALID_CREDENTIALS" || error.code === "REGISTRATION_FAILED")
      ) {
        await writeAuditLog({
          action: "authentication_failed",
          requestId,
          endpoint,
          outcome: "failure",
          metadata: { code: error.code },
        });
      } else if (status === 401 || status === 403) {
        await writeAuditLog({
          action: "authorization_failed",
          requestId,
          endpoint,
          outcome: "failure",
          userId,
          metadata: { status },
        });
      }

      return applyResponseHeaders(
        NextResponse.json(mapped.body, { status: mapped.status }),
        requestId,
        mapped.retryAfterSeconds,
      );
    } finally {
      logInfo("request_completed", {
        requestId,
        endpoint,
        result: status,
        latencyMs: Date.now() - started,
        ...(process.env.NODE_ENV === "development"
          ? { authenticated: Boolean(userId), code: errorCode ?? "OK" }
          : { userId: userId ?? null }),
      });
    }
  };
}
