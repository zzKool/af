/**
 * Date formatting utilities. Takes explicit locale parameter — no module-level globals.
 */

/**
 * Resolve a locale string to a supported Intl locale.
 * Falls back gracefully if the locale is not supported by the runtime.
 * Fallback chain: provided locale → "sv-SE" (project default).
 */
export function resolveLocale(locale?: string | null): string {
  if (!locale) return "sv-SE";
  try {
    const supported = Intl.DateTimeFormat.supportedLocalesOf([locale]);
    return supported.length > 0 ? supported[0] : "sv-SE";
  } catch {
    return "sv-SE";
  }
}

export function formatDateTime(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** `14:05` — the time of day on the business clock (Europe/Stockholm, as `clock.today()`), the same on server and
 *  client, so a server-rendered time never shifts on hydration (F159: Reconcile's *Done today*). */
export function formatTimeOfDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Stockholm",
  }).format(d);
}

export function formatDateShort(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
  }).format(d);
}

/**
 * Convenience date formatter with optional locale parameter.
 * Uses Intl.DateTimeFormat with "long" dateStyle for human-readable output.
 */
export function formatDate(date: Date | string, locale?: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const resolved = resolveLocale(locale);
  return new Intl.DateTimeFormat(resolved, {
    dateStyle: "long",
  }).format(d);
}

/** `2026-07` → `July 2026` (`long`) or `Jul 2026` (`short`) in the UI language — a month named, not a day. */
export function formatMonth(
  month: string,
  locale: string,
  style: "long" | "short" = "long",
): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
  return new Intl.DateTimeFormat(locale, { month: style, year: "numeric", timeZone: "UTC" }).format(
    d,
  );
}
