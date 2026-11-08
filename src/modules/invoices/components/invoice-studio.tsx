"use client";

// The invoice studio (F143, Pulse phase 7; the board *Invoice studio*): the draft's A4 page, live in the document's
// language, beside what the owner needs before sending — the client, *Ready to send?* re-checked as he types,
// *When will it be paid?* from the client's history. The editor is unchanged (D7: one sheet, two modes); the studio
// reads its draft through `onDraft`.
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import type { PrintedParties } from "@/modules/invoices/types";
import { expectedPayment, paymentStats } from "../payment-stats";
import { type ReadyKey, type ReadyState, readyToSend } from "../ready";
import type { StudioFacts } from "../studio";
import type { Registration, VatTreatment } from "../vat-treatment";
import { type EditorDraft, type EditorInvoice, InvoiceEditor } from "./invoice-editor";

const CARD = "rounded-2xl border border-subtle bg-surface p-4 shadow-card";
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
}) {
  const t = useT();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const onDraft = useCallback((d: EditorDraft) => setDraft(d), []);

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

      <div className="min-w-0 rounded-2xl border border-subtle bg-surface-2 p-4 shadow-card">
        <InvoiceEditor
          invoice={invoice}
          parties={parties}
          numberHint={numberHint}
          relatedNumber={relatedNumber}
          registrations={registrations}
          partnerForVat={partnerForVat}
          onDraft={onDraft}
        />
      </div>
    </div>
  );
}
