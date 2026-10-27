// A linkable's label split into its business key and the rest, so the key renders as a `<CodeChip>` (D40).
// Labels are the owning module's `summary().label`; the keyed types lead with their key (`{key} · …`):
// invoice (`VA26-INV-001 · …`), supplier invoice (`SI-…`), expense (`Ex…`), document
// (its business key, else its file name). Bank rows lead with a date, partners and
// contracts are names — no key. Pure, client-safe.
import type { LinkableType } from "./types";

export const KEYED_TYPES: readonly LinkableType[] = [
  "invoice",
  "supplier_invoice",
  "expense",
  "document",
];

const SEP = " · ";

export function splitLabelKey(
  type: LinkableType,
  label: string,
): { key: string | null; rest: string } {
  if (!KEYED_TYPES.includes(type) || label.trim() === "") return { key: null, rest: label };
  const at = label.indexOf(SEP);
  return at < 0
    ? { key: label, rest: "" }
    : { key: label.slice(0, at), rest: label.slice(at + SEP.length) };
}
