import { SUPPORTED_UI_LANGUAGES } from "./translate";

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

  const best = parsed[0]?.locale;
  return best && best !== "*" ? best : "en";
}

/**
 * The UI language for a page outside the signed-in shell (login, register): the first language in the
 * Accept-Language header, by quality, that has a dictionary — `de-CH,fr;q=0.9` → `fr`. English when none has.
 */
export function uiLanguageFromAcceptLanguage(acceptLanguageHeader: string | null): string {
  const tags = (acceptLanguageHeader ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, q] = part.trim().split(";");
      const quality = q?.trim().startsWith("q=") ? Number.parseFloat(q.trim().slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isNaN(quality) ? 0 : quality, index };
    })
    .filter((t) => t.tag && t.tag !== "*" && t.quality > 0)
    // stable: equal qualities keep the header's order
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of tags) {
    const lang = tag.toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_UI_LANGUAGES.includes(lang)) return lang;
  }
  return "en";
}
