// The document itself (D7, invoice-pdf skill): ONE layout for the editor and the PDF. `mode="print"` renders
// values only and is what `/print/invoice/[id]` serves to Chromium; `mode="edit"` places inputs where the values
// sit, supplied by the editor through `slots` — this file owns the layout and the formatting, never state.
// No hooks, no "use client": a server component can render it as is.
import type { ReactNode } from "react";
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
};

/** What the editor renders in place of a value. Absent slot = the value prints. */
export type SheetSlots = {
  issueDate?: ReactNode;
  dueDate?: ReactNode;
  periodLabel?: ReactNode;
  references?: ReactNode;
  lines?: ReactNode;
  discount?: ReactNode;
  notes?: ReactNode;
  paymentTerms?: ReactNode;
  /** rendered under the title block (language, registration pickers) */
  headerTools?: ReactNode;
};

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

export function InvoiceSheet({ mode, doc, slots = {} }: SheetProps) {
  const t = translator(doc.language);
  const edit = mode === "edit";
  const isCredit = doc.type === "credit_note";
  const sign = isCredit ? "−" : "";
  const money = (amount: string, whole = false) =>
    `${sign}${sheetMoney(amount, doc.currency, whole)}`;
  const { tenant, partner, bank } = doc.parties;
  const vatColumn =
    doc.lines.some((l) => l.vatRate !== doc.lines[0]?.vatRate) || doc.lines.length === 0;
  const title = t(`invoice.title.${doc.type}` as MessageKey);
  const addressLines = (a: PrintedParties["partner"]["address"]) =>
    a
      ? [a.street, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean)
      : [];
  const termsSentence =
    doc.paymentTermsText ??
    (doc.type !== "quote" && doc.paymentTermsDays !== null
      ? t("invoice.payment.termsDefault", { days: doc.paymentTermsDays })
      : null);

  return (
    <article
      className="sheet relative mx-auto flex w-full max-w-[210mm] flex-col gap-6 bg-white p-[15mm] text-[11pt] leading-snug text-black shadow-sm print:max-w-none print:p-0 print:shadow-none"
      data-mode={mode}
      lang={doc.language}
    >
      {/* header: company (left) · title + number (right) */}
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          {tenant.logoUrl ? (
            // biome-ignore lint/performance/noImgElement: the PDF renderer wants a plain <img>
            <img
              src={tenant.logoUrl}
              alt={tenant.name}
              className="mb-2 max-h-[20mm] max-w-[60mm]"
            />
          ) : (
            <div className="text-[16pt] font-semibold">{tenant.name}</div>
          )}
        </div>
        <div className="text-right">
          <div
            className="text-[18pt] font-semibold"
            style={isCredit ? { color: "#b91c1c" } : undefined}
          >
            {title}
          </div>
          <div className="text-[13pt] tabular-nums" data-testid="sheet-number">
            {doc.number ?? (
              <span className="text-neutral-500">
                {doc.numberHint
                  ? t("invoices.willBe", { number: doc.numberHint })
                  : t("invoice.draft")}
              </span>
            )}
          </div>
          {doc.status === "draft" && doc.number === null && (
            <div className="mt-1 inline-block rounded border border-neutral-400 px-2 text-[9pt] tracking-wider text-neutral-600">
              {t("invoice.draft")}
            </div>
          )}
          {slots.headerTools}
        </div>
      </header>

      {/* parties */}
      <section className="grid grid-cols-2 gap-6">
        <div className="space-y-0.5">
          <div className="font-semibold">{tenant.name}</div>
          {tenant.address?.split(/\n|, /).map((l) => (
            <div key={l}>{l}</div>
          ))}
          {tenant.email && <div>{tenant.email}</div>}
          {tenant.orgNumber && (
            <div>
              {t("invoice.company.orgNumber")}: {tenant.orgNumber}
            </div>
          )}
          {tenant.vatNumber && (
            <div>
              {t("invoice.company.vatNumber")}: {tenant.vatNumber}
            </div>
          )}
        </div>
        <div className="space-y-0.5">
          <div className="font-semibold">{partner.name}</div>
          {addressLines(partner.address).map((l) => (
            <div key={l}>{l}</div>
          ))}
          {partner.vatNumber && (
            <div>
              {t("invoice.client.vatNumber")}: {partner.vatNumber}
            </div>
          )}
        </div>
      </section>

      {/* meta */}
      <section className="grid grid-cols-2 gap-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-neutral-600">{t("invoice.date")}</dt>
          <dd>{slots.issueDate ?? sheetDate(doc.issueDate, doc.language)}</dd>
          {(doc.dueDate || slots.dueDate) && (
            <>
              <dt className="text-neutral-600">
                {doc.type === "quote" ? t("invoice.validUntil") : t("invoice.dueDate")}
              </dt>
              <dd>{slots.dueDate ?? (doc.dueDate ? sheetDate(doc.dueDate, doc.language) : "")}</dd>
            </>
          )}
          {(doc.periodLabel || slots.periodLabel) && (
            <>
              <dt className="text-neutral-600">{t("invoice.period")}</dt>
              <dd>{slots.periodLabel ?? doc.periodLabel}</dd>
            </>
          )}
          {doc.relatedNumber && (
            <dd className="col-span-2 text-neutral-700">
              {isCredit
                ? t("invoice.creditFor", { number: doc.relatedNumber })
                : t("invoice.fromQuote", { number: doc.relatedNumber })}
            </dd>
          )}
        </dl>
        <div>
          {slots.references ?? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {doc.printedReferences.map((r) => (
                <div key={`${r.label}:${r.value}`} className="contents">
                  <dt className="text-neutral-600">{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {/* lines */}
      <section>
        {slots.lines ?? (
          <table className="w-full border-collapse text-left">
            <thead className="border-b border-black">
              <tr>
                <th className="py-1 pr-2 font-semibold">{t("invoice.table.description")}</th>
                <th className="py-1 pr-2 text-center font-semibold">
                  {t("invoice.table.quantity")}
                </th>
                <th className="py-1 pr-2 text-right font-semibold">
                  {t("invoice.table.unitPrice")}
                </th>
                {vatColumn && (
                  <th className="py-1 pr-2 text-right font-semibold">
                    {t("invoice.table.vatPercent")}
                  </th>
                )}
                <th className="py-1 text-right font-semibold">{t("invoice.table.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.key} className="border-b border-neutral-200 align-top">
                  <td className="py-1.5 pr-2 whitespace-pre-wrap">{l.description}</td>
                  <td className="py-1.5 pr-2 text-center tabular-nums">
                    {sheetQuantity(l.quantity, l.unit, t)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {sheetMoney(l.unitPrice, doc.currency, true)}
                  </td>
                  {vatColumn && (
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {formatVatPercent(l.vatRate)}%
                    </td>
                  )}
                  <td className="py-1.5 text-right tabular-nums">{money(l.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* totals */}
      <section className="flex justify-end">
        <table className="w-[80mm] text-right tabular-nums">
          <tbody>
            <tr>
              <td className="py-0.5 pr-4 text-left text-neutral-600">
                {t("invoice.totals.subtotal")}
              </td>
              <td className="py-0.5">{money(doc.subtotal)}</td>
            </tr>
            {(slots.discount || Number(doc.discountAmount) > 0) && (
              <tr>
                <td className="py-0.5 pr-4 text-left text-neutral-600">
                  {t("invoice.totals.discount")}
                  {doc.discountPercent ? ` ${formatVatPercent(doc.discountPercent)}%` : ""}
                  {slots.discount}
                </td>
                <td className="py-0.5" style={{ color: "#b91c1c" }}>
                  −{sheetMoney(doc.discountAmount, doc.currency)}
                </td>
              </tr>
            )}
            {doc.vatByRate.map((v) => (
              <tr key={v.rate}>
                <td className="py-0.5 pr-4 text-left text-neutral-600">
                  {t("invoice.totals.vat")} ({formatVatPercent(v.rate)}%)
                </td>
                <td className="py-0.5">{money(v.vat)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-black font-semibold">
              <td className="py-1 pr-4 text-left">{t("invoice.totals.total")}</td>
              <td className="py-1" style={isCredit ? { color: "#b91c1c" } : undefined}>
                {money(doc.totalAmount)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* VAT sentence (D23) */}
      {doc.treatment === "reverse_charge" && Number(doc.vatAmount) === 0 && (
        <p className="text-[10pt] text-neutral-700">{t("invoice.vat.reverseCharge")}</p>
      )}
      {doc.treatment === "export" && Number(doc.vatAmount) === 0 && (
        <p className="text-[10pt] text-neutral-700">{t("invoice.vat.export")}</p>
      )}

      {/* notes */}
      {(slots.notes || doc.notes) && (
        <section>
          <div className="font-semibold">{t("invoice.notes")}</div>
          {slots.notes ?? <p className="whitespace-pre-wrap">{doc.notes}</p>}
        </section>
      )}

      {/* payment box */}
      {doc.type !== "quote" && (
        <section className="rounded border border-neutral-300 p-3 text-[10pt]">
          <div className="font-semibold">{t("invoice.payment.title")}</div>
          {slots.paymentTerms ?? (termsSentence && <p>{termsSentence}</p>)}
          {doc.number && <p>{t("invoice.payment.pleaseReference", { number: doc.number })}</p>}
          {bank && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              <dt className="text-neutral-600">{t("invoice.payment.bankDetails")}</dt>
              <dd />
              {bank.bankName && (
                <>
                  <dt className="text-neutral-600">{t("invoice.payment.bank")}</dt>
                  <dd>{bank.bankName}</dd>
                </>
              )}
              {bank.accountHolder && (
                <>
                  <dt className="text-neutral-600">{t("invoice.payment.accountHolder")}</dt>
                  <dd>{bank.accountHolder}</dd>
                </>
              )}
              {bank.iban ? (
                <>
                  <dt className="text-neutral-600">{t("invoice.payment.iban")}</dt>
                  <dd className="font-mono">{bank.iban}</dd>
                </>
              ) : (
                <>
                  <dt className="text-neutral-600">{t("invoice.payment.account")}</dt>
                  <dd className="font-mono">{bank.accountNumber}</dd>
                </>
              )}
              {bank.bic && (
                <>
                  <dt className="text-neutral-600">{t("invoice.payment.bicSwift")}</dt>
                  <dd className="font-mono">{bank.bic}</dd>
                </>
              )}
            </dl>
          )}
        </section>
      )}

      {/* footer — fixed at the bottom of every printed page */}
      <footer className="sheet-footer mt-auto border-t border-neutral-300 pt-2 text-center text-[8pt] text-neutral-500">
        {[tenant.name, tenant.email, tenant.website].filter(Boolean).join(" • ")}
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
        .sheet-footer { position: fixed; bottom: 0; left: 0; right: 0; margin: 0; background: white; }
      }
    `}</style>
  );
}
