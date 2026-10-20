// The Swiss VAT return — pure (specs/exports/spec.md US1; harvest specs/invoices/harvest.md H6 §4; D23).
// FTA form "Décompte TVA", méthode effective, contre-prestations convenues, net mode, quarterly, CHF.
//
//   for each invoice of the period (membership by the STORED declaration period, D23):
//     invoice, Swiss client:    200 += net ; 30x/31x/34x by the line's stored rate: base += net, tax += vat
//     invoice, foreign client:  200 += net ; 221 += net                 (place of supply abroad, 0 %)
//     credit note, Swiss:       235 += net ; the rate rows −= its lines (so 379 == 299 holds — the v1 bug, R34)
//     credit note, foreign:     200 −= net ; 221 −= net                 (nets the abroad turnover, nothing taxable)
//   289 = 220 + 221 + 225 + 230 + 235 + 280 ; 299 = 200 − 289 ; 379 = Σ bases ; warn when |379 − 299| > 0.01
//   399 = Σ tax + 383 ; 400 = Σ input VAT of the sources ; 479 = 400 + 405 + 410 − 415 − 420
//   500 = max(0, 399 − 479) ; 510 = max(0, 479 − 399)
// Rates by date: 8.1 / 2.6 / 3.8 → 303 / 313 / 343 ; 7.7 / 2.5 / 3.7 (until 2023-12-31) → 302 / 312 / 342 ;
// any other non-zero rate is a warning, never "defaulted to standard" (R33).
import { Prisma } from "@/generated/prisma/browser";
import type {
  InputVatSourceRow,
  ManualRef,
  ManualRefs,
  RefSource,
  ReturnInvoice,
  SwissVatLine,
  SwissVatRef,
  SwissVatWarning,
} from "./types";
import { MANUAL_REFS } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;
const ZERO = new D(0);
const r2 = (d: Dec): string => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);

export type FormField = {
  ref: SwissVatRef;
  section: SwissVatLine["section"];
  labelFr: string;
  labelEn: string;
  source: RefSource;
  rate?: string;
};

/** The form, in the FTA's order (fixtures/swiss-vat-form-fields.json + the old-rate rows of the 2024+ form). */
export const FORM_FIELDS: readonly FormField[] = [
  {
    ref: "200",
    section: "I",
    labelFr: "Total des contre-prestations convenues",
    labelEn: "Total agreed considerations",
    source: "auto",
  },
  {
    ref: "205",
    section: "I",
    labelFr: "Contre-prestations exclues (art. 21/22)",
    labelEn: "Considerations excluded (art. 21/22)",
    source: "zero",
  },
  {
    ref: "220",
    section: "I",
    labelFr: "Prestations exonérées (art. 23)",
    labelEn: "Exempt supplies (art. 23)",
    source: "manual",
  },
  {
    ref: "221",
    section: "I",
    labelFr: "Prestations fournies à l'étranger",
    labelEn: "Supplies abroad",
    source: "auto",
  },
  {
    ref: "225",
    section: "I",
    labelFr: "Transferts (art. 38)",
    labelEn: "Transfers (art. 38)",
    source: "manual",
  },
  {
    ref: "230",
    section: "I",
    labelFr: "Prestations exclues (art. 21)",
    labelEn: "Excluded supplies (art. 21)",
    source: "zero",
  },
  {
    ref: "235",
    section: "I",
    labelFr: "Diminutions",
    labelEn: "Reductions (credit notes)",
    source: "auto",
  },
  { ref: "280", section: "I", labelFr: "Divers", labelEn: "Other", source: "manual" },
  {
    ref: "289",
    section: "I",
    labelFr: "Total des déductions",
    labelEn: "Total deductions",
    source: "calc",
  },
  {
    ref: "299",
    section: "I",
    labelFr: "Chiffre d'affaires imposable",
    labelEn: "Taxable turnover",
    source: "calc",
  },
  {
    ref: "302",
    section: "II",
    labelFr: "Taux normal 7.7 % (jusqu'au 31.12.2023)",
    labelEn: "Standard rate 7.7 % (until 2023-12-31)",
    source: "auto",
    rate: "7.7",
  },
  {
    ref: "303",
    section: "II",
    labelFr: "Taux normal 8.1 %",
    labelEn: "Standard rate 8.1 %",
    source: "auto",
    rate: "8.1",
  },
  {
    ref: "312",
    section: "II",
    labelFr: "Taux réduit 2.5 % (jusqu'au 31.12.2023)",
    labelEn: "Reduced rate 2.5 % (until 2023-12-31)",
    source: "auto",
    rate: "2.5",
  },
  {
    ref: "313",
    section: "II",
    labelFr: "Taux réduit 2.6 %",
    labelEn: "Reduced rate 2.6 %",
    source: "auto",
    rate: "2.6",
  },
  {
    ref: "342",
    section: "II",
    labelFr: "Taux hébergement 3.7 % (jusqu'au 31.12.2023)",
    labelEn: "Accommodation rate 3.7 % (until 2023-12-31)",
    source: "auto",
    rate: "3.7",
  },
  {
    ref: "343",
    section: "II",
    labelFr: "Taux hébergement 3.8 %",
    labelEn: "Accommodation rate 3.8 %",
    source: "auto",
    rate: "3.8",
  },
  {
    ref: "379",
    section: "II",
    labelFr: "Contrôle de plausibilité",
    labelEn: "Plausibility check (Σ bases)",
    source: "calc",
  },
  {
    ref: "383",
    section: "II",
    labelFr: "Impôt sur les acquisitions",
    labelEn: "Acquisition tax",
    source: "manual",
  },
  {
    ref: "399",
    section: "II",
    labelFr: "Total de l'impôt dû",
    labelEn: "Total tax due",
    source: "calc",
  },
  {
    ref: "400",
    section: "II-bis",
    labelFr: "Impôt préalable (matériel et services)",
    labelEn: "Input tax (goods and services)",
    source: "auto",
  },
  {
    ref: "405",
    section: "II-bis",
    labelFr: "Impôt préalable (investissements)",
    labelEn: "Input tax (investments)",
    source: "manual",
  },
  {
    ref: "410",
    section: "II-bis",
    labelFr: "Dégrèvement ultérieur (art. 32)",
    labelEn: "Subsequent relief (art. 32)",
    source: "manual",
  },
  {
    ref: "415",
    section: "II-bis",
    labelFr: "Corrections (art. 30/31)",
    labelEn: "Corrections (art. 30/31)",
    source: "manual",
  },
  {
    ref: "420",
    section: "II-bis",
    labelFr: "Réduction (art. 33)",
    labelEn: "Reduction (art. 33)",
    source: "manual",
  },
  {
    ref: "479",
    section: "II-bis",
    labelFr: "Total à déduire",
    labelEn: "Total deductible",
    source: "calc",
  },
  {
    ref: "500",
    section: "III",
    labelFr: "Montant à payer",
    labelEn: "Amount payable",
    source: "calc",
  },
  {
    ref: "510",
    section: "III",
    labelFr: "Solde créditeur",
    labelEn: "Credit balance",
    source: "calc",
  },
];

const RATE_ROW: Record<string, SwissVatRef> = {
  "8.1": "303",
  "2.6": "313",
  "3.8": "343",
  "7.7": "302",
  "2.5": "312",
  "3.7": "342",
};

const PERIOD = /^CH (\d{4})\/Q([1-4])$/;

export function isSwissVatPeriod(value: string): boolean {
  return PERIOD.test(value);
}

/** `CH 2026/Q2` → the quarter's ISO bounds. */
export function quarterBounds(period: string): {
  year: number;
  quarter: number;
  from: string;
  to: string;
} {
  const m = PERIOD.exec(period);
  if (!m) throw new Error(`Not a Swiss VAT period: "${period}"`);
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const firstMonth = (quarter - 1) * 3 + 1;
  const from = `${year}-${String(firstMonth).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, firstMonth + 2, 0)).toISOString().slice(0, 10);
  return { year, quarter, from, to };
}

/** The quarter of an ISO date: `2026-05-12` → `CH 2026/Q2`. */
export function periodOfDate(date: string): string {
  const year = date.slice(0, 4);
  const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  return `CH ${year}/Q${q}`;
}

/** Every quarter from `first` to `last` inclusive, newest first. */
export function quartersBetween(first: string, last: string): string[] {
  const a = quarterBounds(first);
  const b = quarterBounds(last);
  const out: string[] = [];
  let y = b.year;
  let q = b.quarter;
  while (y > a.year || (y === a.year && q >= a.quarter)) {
    out.push(`CH ${y}/Q${q}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return out;
}

/** Normalises a rate string for the row lookup: "8.10" → "8.1", "8" → "8". */
export function rateKey(rate: string): string {
  return new D(rate).toString();
}

export type ComputeInput = {
  period: string;
  invoices: readonly ReturnInvoice[];
  inputSources: readonly InputVatSourceRow[];
  manual: ManualRefs;
  today: string;
};

export function computeSwissVatReturn(input: ComputeInput): {
  lines: SwissVatLine[];
  warnings: SwissVatWarning[];
} {
  const { from, to } = quarterBounds(input.period);
  const warnings: SwissVatWarning[] = [];
  if (from > input.today)
    warnings.push({ type: "future_period", message: "Selected period has not yet started" });
  else if (to > input.today)
    warnings.push({ type: "incomplete_period", message: "Selected period has not ended yet" });

  const amount = new Map<SwissVatRef, Dec>();
  const base = new Map<SwissVatRef, Dec>();
  const add = (map: Map<SwissVatRef, Dec>, ref: SwissVatRef, value: Dec | string) =>
    map.set(ref, (map.get(ref) ?? ZERO).plus(value));
  const manual = (ref: ManualRef): Dec => {
    const v = input.manual[ref];
    return v !== undefined && v !== "" ? new D(v) : ZERO;
  };

  for (const inv of input.invoices) {
    const sign = inv.type === "credit_note" ? -1 : 1;
    if (inv.conversion) {
      warnings.push({
        type: "converted",
        message: `${inv.number}: ${inv.currency} converted to CHF at ${inv.conversion.rate} (${inv.conversion.source})`,
        invoice: inv.number,
        currency: inv.currency,
        rate: inv.conversion.rate,
      });
    }
    if (!inv.swissClient) {
      // place of supply abroad: counted in the total and deducted again under 221; a credit note nets both
      add(amount, "200", new D(inv.net).mul(sign));
      add(amount, "221", new D(inv.net).mul(sign));
      continue;
    }
    if (inv.type === "credit_note") add(amount, "235", inv.net);
    else add(amount, "200", inv.net);
    for (const line of inv.lines) {
      const key = rateKey(line.rate);
      if (key === "0") continue;
      const row = RATE_ROW[key];
      if (!row) {
        warnings.push({
          type: "unknown_rate",
          message: `${inv.number}: no form row for a ${line.rate} % line`,
          invoice: inv.number,
          rate: line.rate,
        });
        continue;
      }
      add(base, row, new D(line.net).mul(sign));
      add(amount, row, new D(line.vat).mul(sign));
    }
  }

  const get = (ref: SwissVatRef): Dec => amount.get(ref) ?? ZERO;
  const ref289 = manual("220")
    .plus(get("221"))
    .plus(manual("225"))
    .plus(get("235"))
    .plus(manual("280"));
  const ref299 = get("200").minus(ref289);
  const rateRefs: SwissVatRef[] = ["302", "303", "312", "313", "342", "343"];
  const ref379 = rateRefs.reduce((s, r) => s.plus(base.get(r) ?? ZERO), ZERO);
  if (ref379.minus(ref299).abs().gt("0.01")) {
    warnings.push({
      type: "plausibility_mismatch",
      message: `Σ taxed bases (379) ${r2(ref379)} ≠ taxable turnover (299) ${r2(ref299)}`,
      ref299: r2(ref299),
      ref379: r2(ref379),
    });
  }
  const ref399 = rateRefs.reduce((s, r) => s.plus(get(r)), ZERO).plus(manual("383"));
  const ref400 = input.inputSources.reduce((s, x) => s.plus(x.vat), ZERO);
  const ref479 = ref400
    .plus(manual("405"))
    .plus(manual("410"))
    .minus(manual("415"))
    .minus(manual("420"));
  const diff = ref399.minus(ref479);
  const ref500 = diff.gt(0) ? diff : ZERO;
  const ref510 = diff.lt(0) ? diff.abs() : ZERO;

  const calc: Partial<Record<SwissVatRef, Dec>> = {
    "289": ref289,
    "299": ref299,
    "379": ref379,
    "399": ref399,
    "400": ref400,
    "479": ref479,
    "500": ref500,
    "510": ref510,
  };

  const lines: SwissVatLine[] = FORM_FIELDS.map((f) => {
    const value =
      f.source === "manual"
        ? manual(f.ref as ManualRef)
        : f.source === "zero"
          ? ZERO
          : (calc[f.ref] ?? get(f.ref));
    return {
      ref: f.ref,
      section: f.section,
      labelFr: f.labelFr,
      labelEn: f.labelEn,
      source: f.source,
      amount: r2(value),
      ...(f.rate ? { base: r2(base.get(f.ref) ?? ZERO), rate: f.rate } : {}),
    };
  });
  return { lines, warnings };
}

/** The CSV of v1's export (R37): `ref;label;amount`, one line per form row, `swiss-vat-{year}-Q{q}.csv`. */
export function swissVatCsv(lines: readonly SwissVatLine[], lang: "fr" | "en" = "fr"): string {
  const rows = ["ref;label;amount"];
  for (const l of lines) {
    const label = (lang === "fr" ? l.labelFr : l.labelEn).replace(/;/g, ",");
    rows.push(`${l.ref};${label};${l.amount}`);
    if (l.base !== undefined) rows.push(`${l.ref}.base;${label} — base;${l.base}`);
  }
  return `${rows.join("\r\n")}\r\n`;
}

export function csvFileName(period: string): string {
  const { year, quarter } = quarterBounds(period);
  return `swiss-vat-${year}-Q${quarter}.csv`;
}

export function isManualRef(ref: string): ref is ManualRef {
  return (MANUAL_REFS as readonly string[]).includes(ref);
}
