const KEY = "kada.device";

/**
 * Stable per-browser identity. Treated by the server as a hint rather than a
 * claim: an IP-derived limit backstops rotation.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Storage denied: fall back to a per-session id.
    return crypto.randomUUID();
  }
}
