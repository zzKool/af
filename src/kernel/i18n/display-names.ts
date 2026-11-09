// Countries and languages by name (the owner, 2026-11-09: "you ask a 2-letter country and print the 2 letters").
// The stored value stays the ISO code (`CH`, `fr-CH`); the screen and the printed sheet show the name in the
// reader's language. Pure: `Intl.DisplayNames` only, no data file.

/** ISO 3166-1 alpha-2, the assigned codes. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY " +
  "BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
  "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR " +
  "IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
  "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM " +
  "PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
  "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const LOCALE: Record<string, string> = { en: "en-GB", fr: "fr-CH", sv: "sv-SE", de: "de-CH" };
const localeOf = (lang: string) => LOCALE[lang.slice(0, 2).toLowerCase()] ?? "en-GB";

function display(type: "region" | "language", lang: string, code: string): string | undefined {
  try {
    return new Intl.DisplayNames([localeOf(lang)], { type, languageDisplay: "standard" }).of(code);
  } catch {
    return undefined;
  }
}

/** `CH` (or `ch`) → `Switzerland` / `Suisse` / `Schweiz`; anything that is not two letters comes back as is. */
export function countryName(code: string | null | undefined, lang: string): string | undefined {
  if (!code) return undefined;
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  const upper = code.toUpperCase();
  return display("region", lang, upper) ?? upper;
}

/** Every country, by name in the reader's language — the picker's list. */
export function countryOptions(lang: string): { code: string; name: string }[] {
  const collator = new Intl.Collator(localeOf(lang));
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, lang) ?? code })).sort(
    (a, b) => collator.compare(a.name, b.name),
  );
}

/** `fr-CH` → `French (Switzerland)`; `en` → `English`. */
export function languageName(tag: string | null | undefined, lang: string): string | undefined {
  if (!tag) return undefined;
  return display("language", lang, tag) ?? tag;
}
