// The document itself (D7, invoice-pdf skill): ONE layout for the editor and the PDF. `mode="print"` renders
// values only and is what `/print/invoice/[id]` serves to Chromium; `mode="edit"` places inputs where the values
// sit, supplied by the editor through `slots` — this file owns the layout and the formatting, never state.
// No hooks, no "use client": a server component can render it as is.

import type { ReactNode } from "react";
import { countryName } from "@/kernel/i18n/display-names";
import { type MessageKey, translator } from "@/kernel/i18n/translate";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { formatVatPercent } from "../totals";
import type { InvoiceType, PrintedParties, PrintedReference, VatByRate } from "../types";
import type { VatTreatment } from "../vat-treatment";

/** Everything the sheet prints. Drafts build it live; issued documents pass the stored snapshot. */
export type SheetDocument = {
  type: InvoiceType;
  status: "draft" | "issued" | "sent" | "accepted" | "declined";
  number: string | null;
  /** the hint for drafts: "will be VA26-004" */
  numberHint?: string | null;
  issueDate: string;
  dueDate: string | null;
  periodLabel: string | null;
  currency: string;
  language: string;
  printedReferences: PrintedReference[];
  parties: PrintedParties;
  relatedNumber: string | null;
  notes: string | null;
  paymentTermsText: string | null;
  paymentTermsDays: number | null;
  discountPercent: string | null;
  lines: SheetLine[];
  subtotal: string;
  discountAmount: string;
  netAmount: string;
  vatByRate: VatByRate[];
  vatAmount: string;
  totalAmount: string;
  treatment: VatTreatment;
};

export type SheetLine = {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  netAmount: string;
  /** F146: a discount on this line — printed under its description; the amount is already net of it */
  discountPercent?: string | null;
};

/** What the editor renders in place of a value. Absent slot = the value prints. */
export type SheetSlots = {
  issueDate?: ReactNode;
  dueDate?: ReactNode;
  periodLabel?: ReactNode;
  /** the references' rows (label · value) inside the dates list, and the "+ reference" control */
  references?: ReactNode;
  /** F146: show the VAT % column although every line has the same rate (the owner chose *VAT per line*) */
  vatColumn?: boolean;
  /** the table body's rows, given the columns the sheet shows */
  lines?: (cols: SheetColumns) => ReactNode;
  /** a row after the lines (the "+ line" control) */
  afterLines?: ReactNode;
  /** the discount input — the row shows when there is a discount or this slot is given */
  discount?: ReactNode;
  /** the VAT rate picker, beside "VAT" in the totals */
  vat?: ReactNode;
  /** under the totals (the "+ discount" control) */
  afterTotals?: ReactNode;
  notes?: ReactNode;
  paymentTerms?: ReactNode;
};

/** The columns of the lines table: VAT % only when the lines carry different rates. */
export type SheetColumns = { vat: boolean };

export type SheetProps = {
  mode: "edit" | "print";
  doc: SheetDocument;
  slots?: SheetSlots;
};

// --- formatting (FR-010): currency-driven money, document-language dates, singular/plural units ---

const DATE_LOCALE: Record<string, string> = { en: "en-GB", fr: "fr-CH", sv: "sv-SE", de: "de-CH" };

export function sheetDate(iso: string, language: string): string {
  const locale = DATE_LOCALE[language.slice(0, 2)] ?? "en-GB";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** `CHF 25'944.00`; `whole` drops the decimals of a whole amount (unit prices: `CHF 1'200`). */
export function sheetMoney(amount: string, currency: string, whole = false): string {
  const formatted = formatCurrency(amount, currency as Currency);
  const trimmed = whole && /[.,]00$/.test(formatted) ? formatted.slice(0, -3) : formatted;
  return `${currency} ${trimmed}`;
}

export function sheetQuantity(
  quantity: string,
  unit: string,
  t: (k: MessageKey, p?: Record<string, string | number>) => string,
): string {
  const n = Number(quantity);
  const qty = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  const unitKey = (
    n === 1 ? `invoice.unit.${unit}.one` : `invoice.unit.${unit}.other`
  ) as MessageKey;
  const label = t(unitKey);
  return label === unitKey ? qty : `${qty} ${label}`;
}

/** `CH` (or `ch`) → `Suisse` in the document's language; a country already written out prints as is. */
export function sheetCountry(country: string | undefined, language: string): string | undefined {
  return countryName(country, language);
}

// The shape (F145) is the owner's own invoice: the logo centred on top; "Invoice VA26-…" on the right; the
// company (left) and the client (right), the dates, period and references under the client as a bold list;
// a grey table header; the totals with a grey total row; the payment box grey; the footer line.
const GREY = "#f3f4f6";
const MUTED = "#4b5563";

export function InvoiceSheet({ mode, doc, slots = {} }: SheetProps) {
  const t = translator(doc.language);
  const edit = mode === "edit";
  const isCredit = doc.type === "credit_note";
  const sign = isCredit ? "−" : "";
  const money = (amount: string, whole = false) =>
    `${sign}${sheetMoney(amount, doc.currency, whole)}`;
  const { tenant, partner, bank } = doc.parties;
  const cols: SheetColumns = {
    vat: slots.vatColumn || new Set(doc.lines.map((l) => l.vatRate)).size > 1,
  };
  const title = t(`invoice.title.${doc.type}` as MessageKey);
  const partnerAddress = partner.address
    ? [
        partner.address.street,
        [partner.address.postalCode, partner.address.city].filter(Boolean).join(" "),
        sheetCountry(partner.address.country, doc.language),
      ].filter((l): l is string => !!l)
    : [];
  const termsSentence =
    doc.paymentTermsText ??
    (doc.type !== "quote" && doc.paymentTermsDays !== null
      ? t("invoice.payment.termsDefault", { days: doc.paymentTermsDays })
      : null);
  const hasDiscount = Number(doc.discountAmount) > 0;
  const label = (k: MessageKey) => `${t(k)}:`;

  return (
    <article
      className="sheet relative mx-auto flex w-full max-w-[210mm] flex-col bg-white p-[15mm] text-[10pt] leading-snug text-[#111827] shadow-sm print:max-w-none print:p-0 print:shadow-none"
      style={{ fontFamily: "Arial, Helvetica, sans-serif", colorScheme: "light" }}
      data-mode={mode}
      lang={doc.language}
    >
      {/* the logo, centred */}
      {tenant.logoUrl && (
        <div className="mb-[8mm] flex justify-center">
          {/* biome-ignore lint/performance/noImgElement: the PDF renderer wants a plain <img> */}
          <img
            src={tenant.logoUrl}
            alt={tenant.name}
            className="max-h-[18mm] max-w-[70mm] object-contain"
            data-testid="sheet-logo"
          />
        </div>
      )}

      {/* "Invoice VA26-004" on the right */}
      <header className="mb-[7mm] text-right">
        <div className="text-[15pt]" style={isCredit ? { color: "#b91c1c" } : undefined}>
          <span style={{ color: MUTED }}>{title}</span>{" "}
          <span className="font-bold tabular-nums" data-testid="sheet-number">
            {doc.number ?? (
              <span className="font-normal" style={{ color: "#9ca3af" }}>
                {doc.numberHint
                  ? t("invoices.willBe", { number: doc.numberHint })
                  : t("invoice.draft")}
              </span>
            )}
          </span>
        </div>
        {doc.status === "draft" && doc.number === null && (
          <div
            className="mt-1 inline-block rounded border px-2 text-[8pt] tracking-wider"
            style={{ borderColor: "#9ca3af", color: MUTED }}
          >
            {t("invoice.draft")}
          </div>
        )}
      </header>

      {/* the company (left) · the client and the document's facts (right) */}
      <section className="mb-[8mm] grid grid-cols-[minmax(0,1fr)_68mm] gap-[8mm]">
        <div className="flex flex-col gap-[4mm]">
          <div className="space-y-0.5">
            <div className="text-[11pt] font-bold">{tenant.name}</div>
            {tenant.address
              ?.split(/\n|, /)
              .filter(Boolean)
              .map((l) => (
                <div key={l}>{l}</div>
              ))}
          </div>
          <div className="space-y-0.5 text-[9pt]">
            {tenant.email && <div>{tenant.email}</div>}
            {tenant.orgNumber && (
              <div>
                {label("invoice.company.orgNumber")} {tenant.orgNumber}
              </div>
            )}
            {tenant.vatNumber && (
              <div>
                {label("invoice.company.vatNumber")} {tenant.vatNumber}
              </div>
            )}
            {tenant.consultant && (
              <div data-testid="sheet-consultant">
                {label("invoice.company.consultant")} {tenant.consultant}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-[4mm]">
          <div className="space-y-0.5">
            <div className="text-[11pt] font-bold">{partner.name}</div>
            {partnerAddress.map((l) => (
              <div key={l}>{l}</div>
            ))}
            {partner.vatNumber && (
              <div className="text-[9pt]">
                {label("invoice.client.vatNumber")} {partner.vatNumber}
              </div>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-0.5 text-[9pt]">
            <dt>{label("invoice.date")}</dt>
            <dd className="font-bold">
              {slots.issueDate ?? sheetDate(doc.issueDate, doc.language)}
            </dd>
            {(doc.dueDate || slots.dueDate) && (
              <>
                <dt>{label(doc.type === "quote" ? "invoice.validUntil" : "invoice.dueDate")}</dt>
                <dd className="font-bold">
                  {slots.dueDate ?? (doc.dueDate ? sheetDate(doc.dueDate, doc.language) : "")}
                </dd>
              </>
            )}
            {(doc.periodLabel || slots.periodLabel) && (
              <>
                <dt>{label("invoice.period")}</dt>
                <dd className="font-bold">{slots.periodLabel ?? doc.periodLabel}</dd>
              </>
            )}
            {slots.references ??
              doc.printedReferences.map((r) => (
                <div key={`${r.label}:${r.value}`} className="contents">
                  <dt>{r.label}:</dt>
                  <dd className="font-bold">{r.value}</dd>
                </div>
              ))}
          </dl>
          {doc.relatedNumber && (
            <div className="text-[9pt]" style={{ color: MUTED }}>
              {isCredit
                ? t("invoice.creditFor", { number: doc.relatedNumber })
                : t("invoice.fromQuote", { number: doc.relatedNumber })}
            </div>
          )}
        </div>
      </section>

      {/* the lines */}
      <table className="mb-[5mm] w-full border-collapse text-left">
        <thead>
          <tr style={{ background: GREY }}>
            <th className="px-3 py-2 font-bold">{t("invoice.table.description")}</th>
            <th className="w-[22mm] px-2 py-2 text-center font-bold">
              {t("invoice.table.quantity")}
            </th>
            <th className="w-[30mm] px-2 py-2 text-right font-bold">
              {t("invoice.table.unitPrice")}
            </th>
            {cols.vat && (
              <th className="w-[16mm] px-2 py-2 text-right font-bold">
                {t("invoice.table.vatPercent")}
              </th>
            )}
            <th className="w-[32mm] px-3 py-2 text-right font-bold">{t("invoice.table.amount")}</th>
            {edit && <th className="w-[14mm] print:hidden" />}
          </tr>
        </thead>
        <tbody>
          {slots.lines
            ? slots.lines(cols)
            : doc.lines.map((l) => (
                <tr key={l.key} className="align-top" style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td className="px-3 py-2.5 whitespace-pre-wrap">
                    {l.description}
                    {l.discountPercent && Number(l.discountPercent) !== 0 && (
                      <div className="text-[8pt]" style={{ color: MUTED }}>
                        {t("invoice.totals.discount")} {formatVatPercent(l.discountPercent)}%
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center tabular-nums">
                    {sheetQuantity(l.quantity, l.unit, t)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {sheetMoney(l.unitPrice, doc.currency, true)}
                  </td>
                  {cols.vat && (
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {formatVatPercent(l.vatRate)}%
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(l.netAmount)}</td>
                </tr>
              ))}
          {slots.afterLines}
        </tbody>
      </table>

      {/* the totals */}
      <section className="mb-[7mm] flex flex-col items-end">
        <table className="w-[95mm] border-collapse text-right tabular-nums">
          <tbody>
            <tr style={{ borderTop: "1px solid #e5e7eb" }}>
              <td className="px-3 py-1.5 text-left">{t("invoice.totals.subtotal")}</td>
              <td className="px-3 py-1.5">{money(doc.subtotal)}</td>
            </tr>
            {(hasDiscount || slots.discount) && (
              <tr data-testid="sheet-discount">
                <td className="px-3 py-1.5 text-left">
                  {t("invoice.totals.discount")}
                  {!slots.discount && doc.discountPercent
                    ? ` (${formatVatPercent(doc.discountPercent)}%)`
                    : ""}
                  {slots.discount}
                </td>
                <td className="px-3 py-1.5" style={{ color: "#b91c1c" }}>
                  −{sheetMoney(doc.discountAmount, doc.currency)}
                </td>
              </tr>
            )}
            {doc.vatByRate.length === 0 && slots.vat && (
              <tr>
                <td className="px-3 py-1.5 text-left">
                  {t("invoice.totals.vat")} {slots.vat}
                </td>
                <td className="px-3 py-1.5">{money("0")}</td>
              </tr>
            )}
            {doc.vatByRate.map((v, i) => (
              <tr key={v.rate}>
                <td className="px-3 py-1.5 text-left">
                  {t("invoice.totals.vat")}{" "}
                  {i === 0 && slots.vat && !cols.vat ? slots.vat : `(${formatVatPercent(v.rate)}%)`}
                </td>
                <td className="px-3 py-1.5">{money(v.vat)}</td>
              </tr>
            ))}
            <tr className="text-[11pt] font-bold" style={{ background: GREY }}>
              <td className="px-3 py-2.5 text-left">{t("invoice.totals.total")}</td>
              <td className="px-3 py-2.5" style={isCredit ? { color: "#b91c1c" } : undefined}>
                {money(doc.totalAmount)}
              </td>
            </tr>
          </tbody>
        </table>
        {slots.afterTotals}
      </section>

      {/* VAT sentence (D23) */}
      {doc.treatment === "reverse_charge" && Number(doc.vatAmount) === 0 && (
        <p className="mb-[5mm] text-[9pt]" style={{ color: MUTED }}>
          {t("invoice.vat.reverseCharge")}
        </p>
      )}
      {doc.treatment === "export" && Number(doc.vatAmount) === 0 && (
        <p className="mb-[5mm] text-[9pt]" style={{ color: MUTED }}>
          {t("invoice.vat.export")}
        </p>
      )}

      {/* notes — only when there are some */}
      {(slots.notes || doc.notes) && (
        <section className="mb-[5mm]">
          {slots.notes ?? <p className="whitespace-pre-wrap">{doc.notes}</p>}
        </section>
      )}

      {/* the payment box */}
      {doc.type !== "quote" && (
        <section className="rounded-sm p-[5mm] text-[9pt]" style={{ background: "#f9fafb" }}>
          <div className="mb-2 text-[11pt] font-bold">{t("invoice.payment.title")}</div>
          <div className="mb-3">
            {slots.paymentTerms ?? (termsSentence && <span>{termsSentence}</span>)}
            {(doc.number || doc.numberHint) && (
              <>
                {" "}
                {t("invoice.payment.pleaseReference")}{" "}
                <span className="font-bold">{doc.number ?? doc.numberHint}</span>.
              </>
            )}
          </div>
          {bank && (
            <>
              <div className="mb-1 font-bold">{label("invoice.payment.bankDetails")}</div>
              <dl className="grid grid-cols-[38mm_1fr] gap-y-1">
                {bank.bankName && (
                  <>
                    <dt>{label("invoice.payment.bank")}</dt>
                    <dd>{bank.bankName}</dd>
                  </>
                )}
                {bank.accountHolder && (
                  <>
                    <dt>{label("invoice.payment.accountHolder")}</dt>
                    <dd>{bank.accountHolder}</dd>
                  </>
                )}
                {bank.iban ? (
                  <>
                    <dt>{label("invoice.payment.iban")}</dt>
                    <dd>{bank.iban}</dd>
                  </>
                ) : (
                  <>
                    <dt>{label("invoice.payment.account")}</dt>
                    <dd>{bank.accountNumber}</dd>
                  </>
                )}
                {bank.bic && (
                  <>
                    <dt>{label("invoice.payment.bicSwift")}</dt>
                    <dd>{bank.bic}</dd>
                  </>
                )}
              </dl>
            </>
          )}
        </section>
      )}

      {/* footer — fixed at the bottom of every printed page */}
      <footer
        className="sheet-footer mt-auto pt-[10mm] text-center text-[7pt]"
        style={{ color: "#374151" }}
      >
        <div className="pt-2" style={{ borderTop: "1px solid #d1d5db" }}>
          {[tenant.name, tenant.email, tenant.website].filter(Boolean).join(" • ")}
        </div>
      </footer>
      {!edit && <PrintStyles />}
    </article>
  );
}

/** Print CSS lives with the component (docs/pdf.md): A4, margins, repeated table header, no split rows. */
function PrintStyles() {
  return (
    <style>{`
      @page { size: A4; margin: 20mm 15mm 25mm 15mm; }
      @media print {
        html, body { background: white; }
        .sheet { box-shadow: none; max-width: none; padding: 0 0 12mm 0; }
        .sheet thead { display: table-header-group; }
        .sheet tr { break-inside: avoid; }
        /* repeated at the bottom of every page, inside the page box (a negative offset would add a page) */
        .sheet-footer { position: fixed; bottom: 0; left: 0; right: 0; margin: 0; padding: 0; background: white; }
      }
    `}</style>
  );
}
