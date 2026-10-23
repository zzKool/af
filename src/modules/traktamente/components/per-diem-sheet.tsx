// The per-diem breakdown as it prints (D29): the trip, every day with its kind and amount, the meals, the nights,
// the total — the receipt of the per-diem expense. Print mode only, server-component friendly.
import { translator } from "@/kernel/i18n/translate";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { PerDiemStatement } from "@/modules/traktamente/statement";
import { warningText } from "./per-diem-text";

const sek = (v: string) => `${formatCurrency(v, "SEK")} SEK`;

export function PerDiemSheet({
  data,
  locale,
}: {
  data: PerDiemStatement;
  /** the reader's UI locale (`en` · `fr` · `sv`, or a regional tag); null → English */
  locale: string | null;
}) {
  const t = translator(locale);
  const r = data.result;
  return (
    <article
      className="sheet relative mx-auto flex w-full max-w-[210mm] flex-col gap-6 bg-white p-[15mm] text-[11pt] leading-snug text-black shadow-sm print:max-w-none print:p-0 print:shadow-none"
      data-mode="print"
      data-testid="per-diem-sheet"
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
          <div className="text-[16pt] font-semibold">Traktamente</div>
          {data.expense && <div className="font-mono text-[12pt]">{data.expense.key}</div>}
          <div className="text-[9pt] text-neutral-600">{data.group}</div>
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[10pt]">
        <dt className="text-neutral-600">{t("traktamente.trip.departure")}</dt>
        <dd className="tabular-nums">{data.trip.departure}</dd>
        <dt className="text-neutral-600">{t("traktamente.trip.return")}</dt>
        <dd className="tabular-nums">{data.trip.return}</dd>
        <dt className="text-neutral-600">{t("traktamente.trip.country")}</dt>
        <dd>{data.trip.countryCode}</dd>
        {data.trip.agency && (
          <>
            <dt className="text-neutral-600">{t("traktamente.trip.agency")}</dt>
            <dd>{data.trip.agency}</dd>
          </>
        )}
        <dt className="text-neutral-600">{t("traktamente.trip.title")}</dt>
        <dd>
          {t("traktamente.trip.result", {
            days: r.days,
            full: r.fullDays,
            half: r.halfDays,
            nights: r.nights,
          })}
        </dd>
      </dl>

      <table className="w-full border-collapse text-[9.5pt]">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-2 font-semibold">{t("expenses.col.date")}</th>
            <th className="py-1 pr-2 font-semibold">{t("traktamente.year")}</th>
            <th className="py-1 pr-2 font-semibold">{t("traktamente.col.dayKind")}</th>
            <th className="py-1 text-right font-semibold">SEK</th>
          </tr>
        </thead>
        <tbody>
          {r.perDay.map((d) => (
            <tr key={d.date} className="border-b border-neutral-300">
              <td className="py-0.5 pr-2 tabular-nums">{d.date}</td>
              <td className="py-0.5 pr-2 tabular-nums">{d.year}</td>
              <td className="py-0.5 pr-2">{d.kind === "half" ? "½" : "1"}</td>
              <td className="py-0.5 text-right tabular-nums">{formatCurrency(d.amount, "SEK")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto grid w-[100mm] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[10pt]">
        <dt className="text-neutral-600">{t("traktamente.trip.dayTotal")}</dt>
        <dd className="text-right tabular-nums">{sek(r.dayTotal)}</dd>
        {r.meals.deduction !== "0.00" && (
          <>
            <dt className="text-neutral-600">
              {t("traktamente.trip.meals")} ({r.meals.breakfasts}/{r.meals.lunches}/
              {r.meals.dinners})
            </dt>
            <dd className="text-right tabular-nums">−{sek(r.meals.deduction)}</dd>
          </>
        )}
        {r.nightAllowance.nights > 0 && (
          <>
            <dt className="text-neutral-600">
              {t("traktamente.trip.nightTotal")} ({r.nightAllowance.nights} ×{" "}
              {formatCurrency(r.nightAllowance.nightAmount, "SEK")})
            </dt>
            <dd className="text-right tabular-nums">{sek(r.nightAllowance.total)}</dd>
          </>
        )}
        {r.longStayFactor && (
          <>
            <dt className="text-neutral-600">{t("traktamente.trip.longStay")}</dt>
            <dd className="text-right tabular-nums">{r.longStayFactor}</dd>
          </>
        )}
        <dt className="font-semibold">{t("traktamente.trip.total")}</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="per-diem-total">
          {sek(r.total)}
        </dd>
        {r.warnings.map((w) => (
          <dd key={w.message} className="col-span-2 text-[8.5pt] text-neutral-600">
            {warningText(t, w)}
          </dd>
        ))}
      </dl>

      <footer className="sheet-footer mt-auto border-t border-neutral-300 pt-2 text-center text-[8pt] text-neutral-500">
        {data.company.name}
        {data.expense ? ` • ${data.expense.key}` : ""} • {r.computedAt.slice(0, 10)}
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
