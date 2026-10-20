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

export function counterpartyKey(f: CounterpartyFields): string {
  const pick =
    nonEmpty(f.name) ??
    nonEmpty(stripCardPrefix(f.additionalDetails ?? "")) ??
    nonEmpty(f.message) ??
    nonEmpty(f.sender) ??
    nonEmpty(f.recipient) ??
    UNKNOWN;
  return stripCardPrefix(pick)
    .toUpperCase()
    .replace(/\s+\d{4}\s*$/, "") // merchant + card digits: `OPENAI *CHATGPT 1234`
    .replace(/\s+/g, " ")
    .trim();
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}
