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

/** The string for `key` in the user's language, English when the language has no dictionary. */
export function translate(
  locale: string | null | undefined,
  key: MessageKey,
  params?: MessageParams,
): string {
  const dict = DICTIONARIES[uiLanguage(locale)] ?? en;
  return interpolate(dict[key] ?? en[key] ?? key, params);
}

/** A bound translator for one locale (server components, PDFs, jobs). */
export function translator(locale: string | null | undefined) {
  return (key: MessageKey, params?: MessageParams) => translate(locale, key, params);
}
