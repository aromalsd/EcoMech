const KEY = "kada.device";

/**
 * A stable per-browser identity.
 *
 * Deliberately not an account: reporting has to cost zero friction or nobody
 * does it. The server treats this as a hint, not a claim — it is only one
 * input to rate limiting, and an IP-derived limit backstops rotation.
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
    // Private browsing with storage denied: fall back to a per-session id.
    return crypto.randomUUID();
  }
}
