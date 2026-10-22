import { SUPPORTED_UI_LANGUAGES, uiLanguage } from "./translate";

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
 * The browser's preferred locale tag that has a dictionary — the first by quality in the Accept-Language header,
 * kept whole for formatting (`de-CH,fr-CH;q=0.9` → `fr-CH`). Null when none has one (the UI is then English).
 */
export function acceptLanguageTagWithDictionary(
  acceptLanguageHeader: string | null,
): string | null {
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
    if (SUPPORTED_UI_LANGUAGES.includes(tag.toLowerCase().split(/[-_]/)[0])) return tag;
  }
  return null;
}

/**
 * The UI language for a page outside the signed-in shell (login, register): the first language in the
 * Accept-Language header, by quality, that has a dictionary — `de-CH,fr;q=0.9` → `fr`. English when none has.
 */
export function uiLanguageFromAcceptLanguage(acceptLanguageHeader: string | null): string {
  return uiLanguage(acceptLanguageTagWithDictionary(acceptLanguageHeader));
}
