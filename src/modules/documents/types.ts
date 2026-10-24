// The module's DTO types — safe for ui.ts and other modules.

/** The company an invoice should be billed to (D53): its profile name, organisation number and VAT numbers. */
export type CompanyIdentity = {
  name: string;
  orgNumber: string | null;
  vatNumbers: readonly string[];
};

/** `checkBilledTo`'s answer: the printed customer fits the company, does not, or the document names none. */
export type BilledToCheck = "match" | "mismatch" | "unknown";
