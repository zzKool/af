// DTO types of the settings module that other modules' components read (the BAS picker's options).

/**
 * One BAS account as a picker shows it (F125, F95): the code, the name in the UI language (the tenant's own
 * translation → the chart's English → Swedish), the Swedish name as the second line when it differs, the short code
 * that keys an expense / a supplier invoice, the BAS class (the first digit) and the owner's favourite flag.
 * `label` (`654 · IT services (It)`) is the one-line form lists, tests and screen readers use.
 */
export type BasOption = {
  code: string;
  label: string;
  name?: string;
  nameSv?: string | null;
  alias?: string | null;
  classNum?: number;
  favourite?: boolean;
  /** F126: the owner's *Use for* note (English) — the picker's second line; the BAS proposals' prompt reads it */
  useFor?: string | null;
};

/** Where a suggested account comes from — said on screen, never "AI" unless a model proposed it. */
export type BasSuggestionSource = "proposal" | "rule" | "partner" | "history" | "model";

export type BasSuggestion = { code: string; source: BasSuggestionSource; reason?: string };
