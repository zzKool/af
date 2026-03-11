/**
 * Resolve display locale from Accept-Language header.
 * NEVER hardcode sv-SE — use browser preference.
 */
export function resolveLocale(acceptLanguageHeader: string | null): string {
  if (!acceptLanguageHeader) return "en";

  const parsed: { locale: string; quality: number }[] = [];

  for (const part of acceptLanguageHeader.split(",")) {
    const [lang, qPart] = part.trim().split(";");
    const locale = lang.trim();
    if (!locale) continue;
    const quality = qPart?.trim().startsWith("q=") ? Number.parseFloat(qPart.trim().slice(2)) : 1;
    parsed.push({ locale, quality: Number.isNaN(quality) ? 0 : quality });
  }

  parsed.sort((a, b) => b.quality - a.quality);

  return parsed[0]?.locale || "en";
}
