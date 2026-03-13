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
