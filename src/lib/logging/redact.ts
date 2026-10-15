const SENSITIVE_KEY =
  /api[-_]?key|authorization|cookie|password|secret|token|credential|private[-_]?key|session/i;

const MAX_DEPTH = 8;

function redactString(value: string, secrets: readonly string[]): string {
  let output = value;
  for (const secret of secrets) {
    if (secret.length < 8 || !output.includes(secret)) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

export function redact(value: unknown, secrets: readonly string[] = []): unknown {
  return redactValue(value, secrets, 0, new WeakSet<object>());
}

function redactValue(
  value: unknown,
  secrets: readonly string[],
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[redacted]"
      : redactValue(child, secrets, depth + 1, seen);
  }
  return output;
}
