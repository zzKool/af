// String lookup — server-safe (no React). Dictionaries are data: a new language is one file + one line here.
// English is complete; fr and sv are partial (D62): a key they lack shows its English, key by key.
import { type Dictionary, en, type MessageKey, type PartialDictionary } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import { sv } from "./dictionaries/sv";

export type { Dictionary, MessageKey, PartialDictionary };

const DICTIONARIES: Record<string, PartialDictionary> = { en, fr, sv };

export const SUPPORTED_UI_LANGUAGES = Object.keys(DICTIONARIES) as ReadonlyArray<string>;

/** `fr-CH` → `fr`, `sv-SE` → `sv`, `de-CH` → `en` (no dictionary), null → `en`. */
export function uiLanguage(locale: string | null | undefined): string {
  const lang = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return lang && lang in DICTIONARIES ? lang : "en";
}

export type MessageParams = Record<string, string | number>;

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * `3 row(s)` → `3 rows`, `1 row(s)` → `1 row` (the Pulse boards speak; they never write `(s)`): the last number
 * before the word in its clause decides; with none in the text, the first numeric parameter; with neither, the plural.
 * One rule for every dictionary — `2 ligne(s)` → `2 lignes` too.
 */
export function pluralise(text: string, params?: MessageParams): string {
  if (!text.includes("(s)") && !text.includes("(es)")) return text;
  const fromParams = params ? Object.values(params).find((v) => typeof v === "number") : undefined;
  return text.replace(/\((s|es)\)/g, (_match, suffix: string, at: number) => {
    const clause =
      text
        .slice(0, at)
        .split(/[.:;—·(] ?(?=\D|$)|, /)
        .at(-1) ?? "";
    const numbers = clause.match(/\d+(?:[.,]\d+)?/g);
    const n = numbers ? Number(numbers.at(-1)?.replace(",", ".")) : fromParams;
    return n === 1 ? "" : suffix;
  });
}

/** The string for `key` in the user's language, English when the language has no dictionary. */
export function translate(
  locale: string | null | undefined,
  key: MessageKey,
  params?: MessageParams,
): string {
  const dict = DICTIONARIES[uiLanguage(locale)] ?? en;
  return pluralise(interpolate(dict[key] ?? en[key] ?? key, params), params);
}

/** A bound translator for one locale (server components, PDFs, jobs). */
export function translator(locale: string | null | undefined) {
  return (key: MessageKey, params?: MessageParams) => translate(locale, key, params);
}
