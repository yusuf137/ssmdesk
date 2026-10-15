const IP_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^[0-9a-fA-F:]{2,45}$/;

export function trustProxy(): boolean {
  return process.env.TRUST_PROXY === "true";
}

export function getClientIp(request: Request): string | null {
  if (!trustProxy()) return null;

  // One trusted proxy appends the peer address. The last hop is that peer.
  // Earlier hops and x-real-ip can be supplied by the client.
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
  const candidate = hops[hops.length - 1] ?? "";
  if (!candidate || candidate.length > 64) return null;
  if (!IP_PATTERN.test(candidate)) return null;
  return candidate;
}
