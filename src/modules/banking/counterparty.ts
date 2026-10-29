// The counterparty key (Excel "Column1"): one normalised string per bank row that the categorisation rules and
// the partner 360° group by. Pure; derived once at import and stored on the transaction (immutable).
//
// name → additional details (card prefix removed) → message → sender → recipient → UNKNOWN
// then: upper-case, trailing 4-digit card suffix removed, whitespace collapsed.

/** `Kortköp 260727 OPENAI *CHATGPT SUBS` → `OPENAI *CHATGPT SUBS`; `KORT KOP LIVSMEDEL AB` → `LIVSMEDEL AB` */
export function stripCardPrefix(text: string): string {
  return text
    .replace(/^\s*KORTK[ÖO]P\s+\d{6}\s+/i, "")
    .replace(/^\s*KORT\s?K[ÖO]P\s+/i, "")
    .trim();
}

export type CounterpartyFields = {
  name?: string | null;
  additionalDetails?: string | null;
  message?: string | null;
  sender?: string | null;
  recipient?: string | null;
};

const UNKNOWN = "UNKNOWN";

/**
 * A per-transaction reference at the end of a merchant text (D71, F124 (6)): `MICROSOFT#G169504312` (the bill
 * number), `MSFT * E0100ZW7M8` (an order code), `AMZN MKTP SE*2A1BC3DEF`. A key is a *who*, never a *which* —
 * with the reference kept, next month's row of the same merchant is a different key and nothing keyed on it
 * (rules from a row, the counterparty memory, the owner's history) ever recurs. Stripped: a trailing `#…` and a
 * trailing `* CODE` whose code carries a digit (`OPENAI *CHATGPT SUBS` is a product name — kept).
 * `prisma/migrations/*_counterparty_key_without_reference` applies the same two expressions to the stored keys.
 */
export function stripReference(key: string): string {
  return key
    .replace(/\s*#[A-Z0-9][A-Z0-9-]*$/, "")
    .replace(/\s*\*\s*[A-Z0-9]*\d[A-Z0-9]*$/, "")
    .trim();
}

export function counterpartyKey(f: CounterpartyFields): string {
  const pick =
    nonEmpty(f.name) ??
    nonEmpty(stripCardPrefix(f.additionalDetails ?? "")) ??
    nonEmpty(f.message) ??
    nonEmpty(f.sender) ??
    nonEmpty(f.recipient) ??
    UNKNOWN;
  const key = stripReference(
    stripCardPrefix(pick)
      .toUpperCase()
      .replace(/\s+\d{4}\s*$/, "") // merchant + card digits: `OPENAI *CHATGPT 1234`
      .replace(/\s+/g, " ")
      .trim(),
  );
  return key || UNKNOWN;
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}
