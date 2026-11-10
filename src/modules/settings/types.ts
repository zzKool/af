// DTO types of the settings module that other modules' components read (the BAS picker's options).

/**
 * One BAS account as a picker shows it (F125, F95): the code, the name in the UI language (the tenant's own
 * translation → the chart's English → Swedish), the Swedish name as the second line when it differs, the short code
 * that keys an expense / a supplier invoice, the BAS class (the first digit) and the owner's favourite flag.
 * `label` (`6540 · IT services (It)`) is the one-line form lists, tests and screen readers use.
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
  /** D68: BAS's account group (`65`) and its name in English — the picker's sub-heading, searched too */
  groupCode?: string;
  groupName?: string | null;
};

/** Where a suggested account comes from — said on screen, never "AI" unless a model proposed it. */
export type BasSuggestionSource = "proposal" | "rule" | "partner" | "history" | "model";

export type BasSuggestion = { code: string; source: BasSuggestionSource; reason?: string };

/**
 * F126: the AI's account for a document, as a dialog receives it — on top of the picker with its reason; `prefill`
 * (HIGH) fills the empty field, drawn as a proposal, until the owner or a supplier's default replaces it.
 */
export type BasProposalHint = { code: string; reason: string | null; prefill: boolean };

/** F187: why *Use my usual accounts* keeps an account outside the set active — the owner's own data on it, or records. */
export type KeptReason = "shortCode" | "note" | "favourite" | "translations" | "inUse";

/** F187: what *Use my usual accounts* will do — the confirm dialog reads it before anything is written. */
export type MyAccountsPlan = {
  /** the set's accounts not active yet */
  activate: string[];
  /** the set's accounts that get their note (none yet, or the model's draft) — a confirmed note is never touched */
  notes: string[];
  /** the other active accounts that hold nothing of the owner's and no record — removed when he ticks the box */
  deactivate: string[];
  /** the other active accounts that stay, and why */
  kept: { code: string; label: string; reasons: KeptReason[]; uses: number }[];
};

/** F187: one active account after *Use my usual accounts* — the shape Settings → BAS lists. */
export type BasPreferenceRow = {
  id: string;
  basCode: string;
  isFavorite: boolean;
  shortCode: string | null;
  translations: Record<string, unknown> | null;
  useFor: string | null;
  useForState: "draft" | "confirmed" | null;
  basCategory: {
    code: string;
    name: string;
    nameEn: string | null;
    nameFr: string | null;
    className: string;
    classNum: number;
    isCommon: boolean;
    suggestedAlias: string | null;
    groupCode: string;
    kind: "main" | "sub";
    parentCode: string | null;
  };
};
