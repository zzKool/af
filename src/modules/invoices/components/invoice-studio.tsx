"use client";

// The invoice studio (F143, Pulse phase 7; the board *Invoice studio*): the draft's A4 page, live in the document's
// language, beside what the owner needs before sending — the client, *Ready to send?* re-checked as he types,
// *When will it be paid?* from the client's history. The editor is unchanged (D7: one sheet, two modes); the studio
// reads its draft through `onDraft`.
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { formatMonth } from "@/kernel/i18n/format-date";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import type { PrintedParties } from "@/modules/invoices/types";
import { expectedPayment, paymentStats } from "../payment-stats";
import { type ReadyKey, type ReadyState, readyToSend } from "../ready";
import type { StudioFacts } from "../studio";
import type { Registration, VatTreatment } from "../vat-treatment";
import { type EditorDraft, type EditorInvoice, InvoiceEditor } from "./invoice-editor";

const CARD = "pulse-card p-4";
const MARK: Record<ReadyState, string> = { ok: "✓", warn: "!", todo: "○" };

// Each checklist line's words, by key and state (only the pairs `readyToSend` gives).
const READY_TEXT: Record<ReadyKey, Partial<Record<ReadyState, MessageKey>>> = {
  client: { ok: "invoices.ready.client.ok", todo: "invoices.ready.client.todo" },
  lines: { ok: "invoices.ready.lines.ok", todo: "invoices.ready.lines.todo" },
  period: { ok: "invoices.ready.period.ok", warn: "invoices.ready.period.warn" },
  references: { ok: "invoices.ready.references.ok", todo: "invoices.ready.references.todo" },
  vat: { ok: "invoices.ready.vat.ok", warn: "invoices.ready.vat.warn" },
  bank: {
    ok: "invoices.ready.bank.ok",
    warn: "invoices.ready.bank.warn",
    todo: "invoices.ready.bank.todo",
  },
  rate: { ok: "invoices.ready.rate.ok", todo: "invoices.ready.rate.todo" },
  company: { ok: "invoices.ready.company.ok", warn: "invoices.ready.company.warn" },
};
const TREATMENT_TEXT: Record<VatTreatment, MessageKey> = {
  standard: "invoices.ready.treatment.standard",
  reverse_charge: "invoices.ready.treatment.reverse_charge",
  export: "invoices.ready.treatment.export",
  none: "invoices.ready.treatment.none",
};

export function InvoiceStudio({
  invoice,
  parties,
  numberHint,
  relatedNumber,
  registrations,
  partnerForVat,
  partnerName,
  facts,
  today,
  details,
  actions,
}: {
  invoice: EditorInvoice;
  parties: PrintedParties;
  numberHint: string | null;
  relatedNumber: string | null;
  registrations: Registration[];
  partnerForVat: { address: { country?: string } | null; vatNumber: string | null };
  partnerName: string;
  facts: StudioFacts;
  today: string;
  /** the document's details panel, under the studio's cards */
  details?: ReactNode;
  /** F160: the draft's actions (Preview PDF · Issue …) — in the bar at the bottom, beside the total */
  actions?: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const onDraft = useCallback((d: EditorDraft) => setDraft(d), []);
  const [daysRequest, setDaysRequest] = useState<{ days: string[]; seq: number } | null>(null);
  const total = draft?.total ?? invoice.totalAmount;
  // the days calendar sets the first line's days — shown once there is a line
  const firstQuantity = draft ? draft.lines[0]?.quantity : invoice.lines?.[0]?.quantity;

  const ready = useMemo(
    () =>
      draft
        ? readyToSend({
            type: invoice.type,
            partnerShortCode: facts.partnerShortCode,
            lines: draft.lines,
            periodLabel: draft.periodLabel,
            references: draft.printedReferences,
            registration: draft.registration,
            treatment: draft.treatment,
            vatRates: draft.lines.map((l) => l.vatRate),
            currency: invoice.currency,
            bank: facts.bank,
            rateKnown: facts.rateKnown,
            companyMissing: facts.companyMissing,
          })
        : null,
    [draft, facts, invoice.type, invoice.currency],
  );
  const stats = paymentStats(facts.history);
  const expected = expectedPayment(stats, today);

  return (
    <div className="flex flex-col gap-[18px]">
      <div
        className="grid items-start gap-[18px] xl:grid-cols-[22rem_minmax(0,1fr)]"
        data-testid="invoice-studio"
      >
        <aside className="flex flex-col gap-[18px]">
          <section className={cn(CARD, "flex items-center gap-3")}>
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-sm font-semibold"
              aria-hidden
            >
              {(partnerName.trim()[0] ?? "·").toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{partnerName}</div>
              <div className="text-xs text-muted-foreground">
                {invoice.currency} · {(draft?.language ?? invoice.language).toUpperCase()}
              </div>
            </div>
          </section>

          {firstQuantity !== undefined && (
            <DaysWorked
              issueDate={draft?.issueDate ?? invoice.issueDate}
              periodLabel={draft?.periodLabel ?? invoice.periodLabel ?? ""}
              quantity={firstQuantity}
              stored={invoice.lines?.[0]?.workedDays ?? []}
              onDays={(days) => setDaysRequest((r) => ({ days, seq: (r?.seq ?? 0) + 1 }))}
            />
          )}

          {ready && (
            <section className={cn(CARD, "flex flex-col gap-2")} data-testid="invoice-ready">
              <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                {t("invoices.ready.title")}
                <span
                  className="text-xs font-normal text-muted-foreground"
                  data-testid="invoice-ready-count"
                >
                  {t("invoices.ready.count", { ok: ready.ok, total: ready.items.length })}
                </span>
              </h2>
              <ul className="flex flex-col gap-1.5">
                {ready.items.map((i) => (
                  <li
                    key={i.key}
                    className="flex items-start gap-2 text-[13px]"
                    data-testid="invoice-ready-item"
                    data-key={i.key}
                    data-state={i.state}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                        i.state === "ok" && "bg-state-done/15 text-state-done",
                        i.state === "warn" && "bg-state-attention/15 text-state-attention",
                        i.state === "todo" && "border border-subtle text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      {MARK[i.state]}
                    </span>
                    <span className={cn(i.state === "todo" && "text-muted-foreground")}>
                      {t(READY_TEXT[i.key][i.state] ?? "invoices.ready.title", {
                        ...i.params,
                        ...(i.key === "vat" && i.params?.treatment
                          ? { treatment: t(TREATMENT_TEXT[i.params.treatment as VatTreatment]) }
                          : {}),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={cn(CARD, "flex flex-col gap-1.5")} data-testid="invoice-when-paid">
            <h2 className="text-sm font-semibold">{t("invoices.whenPaid.title")}</h2>
            {stats && expected ? (
              <p className="text-[13px] text-foreground/85">
                {t("invoices.whenPaid.history", {
                  client: partnerName,
                  count: stats.count,
                  min: stats.minDays,
                  max: stats.maxDays,
                })}{" "}
                {t("invoices.whenPaid.expected", { from: expected.from, to: expected.to })}
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {t("invoices.whenPaid.none", { client: partnerName })}
              </p>
            )}
          </section>
          {details && <div className={CARD}>{details}</div>}
        </aside>

        <div className="min-w-0 pulse-card-2 p-4">
          <InvoiceEditor
            invoice={invoice}
            parties={parties}
            numberHint={numberHint}
            relatedNumber={relatedNumber}
            registrations={registrations}
            partnerForVat={partnerForVat}
            onDraft={onDraft}
            daysRequest={daysRequest}
          />
        </div>
      </div>

      {/* F160, the board: the total and the draft's actions in one bar at the bottom */}
      <div
        className="pulse-card sticky bottom-3 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3"
        data-testid="invoice-studio-bar"
      >
        <span className="eyebrow">{t("invoices.studio.total")}</span>
        <span className="text-[24px] font-semibold tabular-nums" data-testid="invoice-studio-total">
          {total ? formatMoney(total, invoice.currency) : "—"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

const DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** `2026-08` → `2026-07` (step −1) */
function shiftMonth(month: string, step: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const n = y * 12 + (m - 1) + step;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}

// month names as a period label may spell them (en · fr · sv), index = month − 1
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["january", "janvier", "januari", "jan"],
  ["february", "février", "fevrier", "februari", "feb"],
  ["march", "mars", "mar"],
  ["april", "avril", "apr"],
  ["may", "mai", "maj"],
  ["june", "juin", "juni", "jun"],
  ["july", "juillet", "juli", "jul"],
  ["august", "août", "aout", "augusti", "aug"],
  ["september", "septembre", "sep"],
  ["october", "octobre", "oktober", "oct", "okt"],
  ["november", "novembre", "nov"],
  ["december", "décembre", "decembre", "dec"],
];

/** `2026 October` / `Juillet 2026` / `2026-07` → `2026-10` …; null when the label names no single month */
export function monthOfPeriod(label: string): string | null {
  const iso = /\b(\d{4})-(0[1-9]|1[0-2])\b/.exec(label);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const year = /\b(\d{4})\b/.exec(label)?.[1];
  if (!year) return null;
  const words = label.toLowerCase().split(/[^\p{L}]+/u);
  const i = MONTH_NAMES.findIndex((names) => names.some((n) => words.includes(n)));
  return i >= 0 ? `${year}-${String(i + 1).padStart(2, "0")}` : null;
}

/** the weekdays (Mon–Fri) of a month, in order */
export function weekdaysOf(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(day);
  }
  return out;
}

/**
 * The days the calendar opens with (F168): the line's stored days when it has some; else, for a line whose quantity
 * is a whole count of days, the month's first weekdays as a *suggestion* (not stored until a day is clicked).
 */
export function daysToShow(
  stored: readonly string[],
  quantity: string,
  month: string,
): { days: string[]; suggested: boolean } {
  if (stored.length > 0) return { days: [...stored], suggested: false };
  const n = Number(quantity);
  const weekdays = weekdaysOf(month);
  return Number.isInteger(n) && n > 0 && n <= weekdays.length
    ? { days: weekdays.slice(0, n), suggested: true }
    : { days: [], suggested: false };
}

/**
 * F160 / F168, the board's *Days worked*: the invoice's period as a calendar — the month of the line's stored days,
 * else the month its label names, else the month before the issue date. A click adds or removes a day; the first
 * line then stores the days picked and bills their count. The days may span two months (a period from the 15th);
 * a quantity typed by hand (half days) keeps the days and the calendar says so.
 */
function DaysWorked({
  issueDate,
  periodLabel,
  quantity,
  stored,
  onDays,
}: {
  issueDate: string;
  periodLabel: string;
  quantity: string;
  stored: readonly string[];
  onDays: (days: string[]) => void;
}) {
  const t = useT();
  const lang = useUiLanguage();
  const [month, setMonth] = useState(
    () =>
      stored[0]?.slice(0, 7) ?? monthOfPeriod(periodLabel) ?? shiftMonth(issueDate.slice(0, 7), -1),
  );
  // the owner's days once stored or clicked; until then a suggestion that follows the line's quantity and the month
  const [own, setOwn] = useState<Set<string> | null>(() =>
    stored.length > 0 ? new Set(stored) : null,
  );
  const shown = useMemo(() => daysToShow([], quantity, month), [quantity, month]);
  const picked = own ?? new Set(shown.days);
  const suggested = own === null && shown.suggested;
  const go = (step: number) => setMonth(shiftMonth(month, step));
  const [y, mm] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, mm - 1, 1)).getUTCDay() + 6) % 7;
  const toggle = (day: string) => {
    const next = new Set(picked);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setOwn(next);
    onDays([...next].sort());
  };
  const elsewhere = [...picked].filter((d) => !d.startsWith(month)).length;
  const differs = !suggested && picked.size > 0 && Number(quantity) !== picked.size;
  return (
    <section className={cn(CARD, "flex flex-col gap-3")} data-testid="invoice-days">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">
          {t("invoices.days.title", { month: formatMonth(month, lang) })}
        </h2>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            className="rounded-md px-1.5 text-xs text-muted-foreground hover:bg-hover"
            onClick={() => go(-1)}
            aria-label={t("invoices.days.previous")}
          >
            ‹
          </button>
          <button
            type="button"
            className="rounded-md px-1.5 text-xs text-muted-foreground hover:bg-hover"
            onClick={() => go(1)}
            aria-label={t("invoices.days.next")}
          >
            ›
          </button>
        </span>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground" data-testid="invoice-days-hint">
        {t(suggested ? "invoices.days.suggested" : "invoices.days.hint", { count: picked.size })}
        {elsewhere > 0 && <> · {t("invoices.days.elsewhere", { count: elsewhere })}</>}
        {differs && (
          <span className="text-state-attention">
            {" "}
            · {t("invoices.days.differs", { quantity })}
          </span>
        )}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {DOW.map((d) => (
          <span key={d} className="eyebrow text-[10px]">
            {t(`invoices.days.dow.${d}`)}
          </span>
        ))}
        {lead > 0 && <span style={{ gridColumn: `span ${lead}` }} />}
        {Array.from({ length: days }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`;
          const weekend = (lead + i) % 7 >= 5;
          const on = picked.has(day);
          return (
            <button
              key={day}
              type="button"
              disabled={weekend}
              aria-pressed={on}
              onClick={() => toggle(day)}
              data-testid="invoice-day"
              data-day={day}
              className={cn(
                "flex h-8 items-center justify-center rounded-lg text-xs tabular-nums transition-colors",
                weekend && "text-muted-foreground/50",
                !weekend && !on && "border border-subtle hover:bg-hover",
                on && "border border-state-done/60 bg-state-done/15 font-semibold text-state-done",
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </section>
  );
}
