// The one normaliser of a supplier's invoice number (D35, lessons audit 32) — pure, a leaf: the refusal on create /
// edit (`checkDuplicateNumber`) and the duplicate finder (`duplicates.ts`) compare through it, so they cannot drift.

/** trim, collapse spaces, case-fold — `9160`, ` 9160 ` and `9160 ` are the same number; so are `91 60` and `91  60` */
export const normaliseInvoiceNumber = (n: string | null | undefined) =>
  (n ?? "").trim().replace(/\s+/g, " ").toLowerCase();
