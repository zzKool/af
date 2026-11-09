"use client";

// Beside the new-invoice form (F163, Pulse everywhere): what happens after *Create draft*, in three steps — the
// contract fills the line, the studio opens on the days worked and *Ready to send?*, the number comes at Issue.
import { useT } from "@/kernel/i18n/use-t";
import { PulseSection } from "@/kernel/ui/pulse";

const STEPS = ["contract", "studio", "issue"] as const;

export function NewInvoiceSteps() {
  const t = useT();
  return (
    <PulseSection title={t("invoices.newSteps.title")} testId="new-invoice-steps">
      <ol className="flex flex-col gap-4">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span
              className={
                i === 0
                  ? "flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[12px] font-semibold text-background"
                  : "flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-[12px] font-semibold text-muted-foreground"
              }
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">{t(`invoices.newSteps.${s}.title`)}</span>
              <span className="text-xs text-muted-foreground">
                {t(`invoices.newSteps.${s}.text`)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </PulseSection>
  );
}
