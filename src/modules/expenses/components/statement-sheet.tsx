// The reimbursement statement (US4-7, invoice-pdf skill): print mode only — generated, never edited. Served by
// `/print/settlement/[id]` to Chromium and shown read-only on the settlement page. Server-component friendly.
import { translator } from "@/kernel/i18n/translate";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import type { StatementData } from "@/modules/expenses/statement";

const sek = (amount: string) => formatCurrency(amount, "SEK");
const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

export function StatementSheet({
  data,
  locale,
}: {
  data: StatementData;
  locale: "en" | "fr" | null;
}) {
  const t = translator(locale);
  const cancelled = data.status === "cancelled";
  return (
    <article
      className="sheet relative mx-auto flex w-full max-w-[210mm] flex-col gap-6 bg-white p-[15mm] text-[11pt] leading-snug text-black shadow-sm print:max-w-none print:p-0 print:shadow-none"
      data-mode="print"
      data-testid="statement-sheet"
    >
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="text-[13pt] font-semibold">{data.company.name}</div>
          {data.company.orgNumber && (
            <div className="text-[9pt] text-neutral-600">{data.company.orgNumber}</div>
          )}
          {data.company.address && (
            <div className="whitespace-pre-line text-[9pt] text-neutral-600">
              {data.company.address}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[16pt] font-semibold">{t("expenses.statement.title")}</div>
          <div className="font-mono text-[12pt]">{data.number}</div>
          <div className="text-[9pt] text-neutral-600">
            {t("expenses.statement.generated", { date: data.createdAt.toISOString().slice(0, 10) })}
          </div>
        </div>
      </header>

      {(cancelled || data.statementSuperseded) && (
        <div className="border-2 border-red-700 p-2 text-center text-[11pt] font-semibold text-red-700">
          {t("expenses.statement.superseded")}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[10pt]">
        <dt className="text-neutral-600">{t("expenses.statement.payee")}</dt>
        <dd>{data.payee}</dd>
        <dt className="text-neutral-600">{t("expenses.statement.refund")}</dt>
        <dd className="tabular-nums">
          {data.refund.bookingDate} · {money(data.refund.amount, data.refund.currency)}
          {data.refund.currency !== "SEK" ? ` = ${sek(data.refund.base)} SEK` : ""}
        </dd>
        <dt className="text-neutral-600">{t("expenses.statement.account")}</dt>
        <dd>{data.refund.account}</dd>
      </dl>

      <table className="w-full border-collapse text-[9.5pt]">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-2 font-semibold">{t("expenses.statement.col.key")}</th>
            <th className="py-1 pr-2 font-semibold">{t("expenses.statement.col.date")}</th>
            <th className="py-1 pr-2 font-semibold">{t("expenses.statement.col.description")}</th>
            <th className="py-1 pr-2 font-semibold">{t("expenses.statement.col.group")}</th>
            <th className="py-1 pr-2 text-right font-semibold">
              {t("expenses.statement.col.amount")}
            </th>
            <th className="py-1 pr-2 text-right font-semibold">
              {t("expenses.statement.col.base")}
            </th>
            <th className="py-1 pr-2 text-right font-semibold">
              {t("expenses.statement.col.allocated")}
            </th>
            <th className="py-1 text-right font-semibold">{t("expenses.statement.col.open")}</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.key} className="border-b border-neutral-300 align-top">
              <td className="py-1 pr-2 font-mono text-[9pt]">{l.key}</td>
              <td className="py-1 pr-2 tabular-nums">{l.date}</td>
              <td className="py-1 pr-2">
                {l.description}
                {l.note && <div className="text-[8pt] text-neutral-600">{l.note}</div>}
              </td>
              <td className="py-1 pr-2 text-[8.5pt] text-neutral-700">{l.group}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{money(l.amount, l.currency)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{sek(l.amountBase)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{sek(l.allocatedBase)}</td>
              <td className="py-1 text-right tabular-nums">{sek(l.remainingOpen)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto grid w-[90mm] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[10pt]">
        <dt className="font-semibold">{t("expenses.statement.total")}</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="statement-total">
          {sek(data.totals.allocatedBase)} SEK
        </dd>
        {data.totals.exchangeDifferenceBase !== "0.00" && (
          <>
            <dt className="text-neutral-600">
              {t("expenses.statement.exchange")}
              {data.totals.exchangeDifferenceBasCode
                ? ` (BAS ${data.totals.exchangeDifferenceBasCode})`
                : ""}
            </dt>
            <dd className="text-right tabular-nums">
              {sek(data.totals.exchangeDifferenceBase)} SEK
            </dd>
          </>
        )}
        {data.totals.roundingBase !== "0.00" && (
          <>
            <dt className="text-neutral-600">{t("expenses.statement.rounding")}</dt>
            <dd className="text-right tabular-nums">{sek(data.totals.roundingBase)} SEK</dd>
          </>
        )}
        <dt className="text-neutral-600">{t("expenses.statement.residual")}</dt>
        <dd className="text-right tabular-nums">{sek(data.totals.residualOpen)} SEK</dd>
      </dl>

      {data.note && <p className="text-[9.5pt] text-neutral-700">{data.note}</p>}

      <footer className="sheet-footer mt-auto border-t border-neutral-300 pt-2 text-center text-[8pt] text-neutral-500">
        {data.company.name} • {data.number}
      </footer>
      <style>{`
        @page { size: A4; margin: 20mm 15mm 25mm 15mm; }
        @media print {
          html, body { background: white; }
          .sheet { box-shadow: none; max-width: none; padding: 0 0 12mm 0; }
          .sheet thead { display: table-header-group; }
          .sheet tr { break-inside: avoid; }
          .sheet-footer { position: fixed; bottom: 0; left: 0; right: 0; margin: 0; background: white; }
        }
      `}</style>
    </article>
  );
}
