// DTOs of the exports module (specs/exports/spec.md). Plain types; money as decimal strings with two decimals.

/** The refs of the FTA form "Décompte TVA" (méthode effective, contre-prestations convenues, net). */
export const SWISS_VAT_REFS = [
  "200",
  "205",
  "220",
  "221",
  "225",
  "230",
  "235",
  "280",
  "289",
  "299",
  "302",
  "303",
  "312",
  "313",
  "342",
  "343",
  "379",
  "383",
  "399",
  "400",
  "405",
  "410",
  "415",
  "420",
  "479",
  "500",
  "510",
] as const;
export type SwissVatRef = (typeof SWISS_VAT_REFS)[number];

/** The refs the owner types on the form page (everything else is computed or always zero for AF). */
export const MANUAL_REFS = ["220", "225", "280", "383", "405", "410", "415", "420"] as const;
export type ManualRef = (typeof MANUAL_REFS)[number];
export type ManualRefs = Partial<Record<ManualRef, string>>;

export type RefSource = "auto" | "calc" | "manual" | "zero";

export type SwissVatLine = {
  ref: SwissVatRef;
  /** section I turnover / II tax / II-bis input tax / III settlement */
  section: "I" | "II" | "II-bis" | "III";
  labelFr: string;
  labelEn: string;
  source: RefSource;
  /** the amount (turnover, deduction, tax) in CHF */
  amount: string;
  /** rate rows (302 … 343): the taxable base the tax is computed on */
  base?: string;
  rate?: string;
};

export type SwissVatWarning =
  | { type: "future_period"; message: string }
  | { type: "incomplete_period"; message: string }
  | { type: "snapshot_unreadable"; message: string }
  | { type: "plausibility_mismatch"; message: string; ref299: string; ref379: string }
  | { type: "unknown_rate"; message: string; invoice: string; rate: string }
  | { type: "zero_rate_swiss_client"; message: string; invoice: string; amount: string }
  | { type: "converted"; message: string; invoice: string; currency: string; rate: string };

/** One invoice's VAT at one rate — the invoice's stored `vatByRate` row (header discount included), in CHF. */
export type ReturnRate = { rate: string; base: string; vat: string };

/** One invoice of the return, as the drill-down shows it (amounts in CHF). */
export type ReturnInvoice = {
  id: string;
  number: string;
  type: "invoice" | "credit_note";
  issueDate: string;
  client: string;
  clientCountry: string | null;
  /** the printed country reads Swiss — information only: the rows are decided by the stored rates (lesson 21) */
  swissClient: boolean;
  currency: string;
  /** net in CHF (converted when the invoice is not in CHF), after the header discount */
  net: string;
  /** Σ `rates[].vat` */
  vat: string;
  /** the taxed part, one row per non-zero rate, from the invoice's `vatByRate` */
  rates: ReturnRate[];
  /** the part at 0 % (net − Σ taxed bases when the invoice has 0 % lines, else 0) → 221 */
  zeroRated: string;
  /** the conversion applied, when any */
  conversion: { rate: string; source: string } | null;
};

export type InputVatSourceRow = {
  kind: "supplier_invoice" | "expense";
  id: string;
  key: string;
  label: string;
  date: string;
  currency: string;
  net: string;
  /** VAT in CHF (converted when not in CHF) */
  vat: string;
  conversion: { rate: string; source: string } | null;
};

export type SwissVatReturn = {
  registrationId: string;
  vatNumber: string;
  period: string;
  from: string;
  to: string;
  lines: SwissVatLine[];
  invoices: ReturnInvoice[];
  inputSources: InputVatSourceRow[];
  warnings: SwissVatWarning[];
  declaration: SwissVatDeclarationDto | null;
};

export type SwissVatDeclarationDto = {
  id: string;
  tenantId: string;
  vatRegistrationId: string;
  period: string;
  manual: ManualRefs;
  /** the lines as declared (null while a draft) */
  snapshot: SwissVatLine[] | null;
  declaredAt: string | null;
  paidAt: string | null;
  paymentExpenseId: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};
