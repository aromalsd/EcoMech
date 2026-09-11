/** "just now" / "4 min ago" / "2 h ago" — short enough for a dense card. */
export function relativeTime(from: Date | string | null, now: Date = new Date()): string {
  if (!from) return "never";
  const then = typeof from === "string" ? new Date(from) : from;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "never";
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Clock time in IST, e.g. "4:20 pm". */
export function istClock(value: Date | string | null): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  })
    .format(date)
    .toLowerCase();
}

export function rupees(paise: number | null): string | null {
  if (paise == null) return null;
  return `₹${(paise / 100).toFixed(0)}`;
}
