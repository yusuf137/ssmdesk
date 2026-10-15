import "server-only";

import { redact } from "@/lib/logging/redact";

type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const SECRET_ENV_NAMES = [
  "SMMFULL_API_KEY",
  "FIREBASE_WEB_API_KEY",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "UPSTASH_REDIS_REST_TOKEN",
  "PAYTR_MERCHANT_KEY",
  "PAYTR_MERCHANT_SALT",
] as const;

function knownSecrets(): string[] {
  const secrets: string[] = [];
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8) secrets.push(value);
  }
  return secrets;
}

function write(level: LogLevel, event: string, fields: LogFields): void {
  const payload = redact(
    {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    },
    knownSecrets(),
  );
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function logInfo(event: string, fields: LogFields = {}): void {
  write("info", event, fields);
}

export function logWarn(event: string, fields: LogFields = {}): void {
  write("warn", event, fields);
}

export function logError(event: string, fields: LogFields = {}): void {
  write("error", event, fields);
}
