const DEFAULT_TZ = "Asia/Jakarta";

export function formatDateTime(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** "2h 05m", "45m 10s", "0m" */
export function formatDuration(totalSeconds: number | null | undefined, withSeconds = false): string {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (withSeconds) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (s > 0 && m === 0) return "<1m";
  return `${m}m`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return rtf.format(Math.round(diff / (86400 * 30)), "month");
}

/** Compact countdown text for a deadline, e.g. "2d 4h left" / "3h overdue". */
export function deadlineText(iso: string | null | undefined, now = Date.now()): { text: string; tone: "ok" | "soon" | "overdue" | "none" } {
  if (!iso) return { text: "No deadline", tone: "none" };
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  if (diff < 0) return { text: `${span} overdue`, tone: "overdue" };
  return { text: `${span} left`, tone: diff < 24 * 3_600_000 ? "soon" : "ok" };
}

/** Converts an ISO timestamp to the value of a <input type="datetime-local"> in a time zone. */
export function toDateTimeLocal(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * Interprets a datetime-local value ("2026-11-20T17:00") as wall-clock time in
 * the given time zone and returns an ISO UTC string.
 */
export function fromDateTimeLocal(value: string, timeZone = DEFAULT_TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Find the zone offset at that instant, then correct (two passes handle DST edges).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const local = toDateTimeLocal(new Date(guess).toISOString(), timeZone);
    const lm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
    if (!lm) return null;
    const [, ly, lmo, ld, lh, lmi] = lm.map(Number);
    const shown = Date.UTC(ly, lmo - 1, ld, lh, lmi);
    guess += asUtc - shown;
  }
  return new Date(guess).toISOString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
