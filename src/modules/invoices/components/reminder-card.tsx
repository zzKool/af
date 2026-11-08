"use client";

// The reminder drafted when late (F143, the board *Invoice studio*): from three days after the due date, while
// something is open, the invoice page offers a reminder in the document's language — copied, or opened in the
// mail app with the client's address. The app sends nothing.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { translator } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { type ReminderFacts, reminderDraft } from "../reminder";

export function ReminderCard({
  facts,
  language,
  today,
  email,
}: {
  facts: ReminderFacts;
  language: string;
  today: string;
  email: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const draft = useMemo(
    () => reminderDraft(facts, today, translator(language)),
    [facts, language, today],
  );
  const mailto = `mailto:${email ?? ""}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  return (
    <section
      className="flex flex-col gap-2 rounded-2xl border border-state-attention/30 bg-state-attention/6 p-4"
      data-testid="invoice-reminder"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {t("invoices.reminder.title", { days: draft.daysLate })}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(!open)}
          data-testid="invoice-reminder-toggle"
        >
          {open ? t("invoices.reminder.hide") : t("invoices.reminder.show")}
        </Button>
      </div>
      {open && (
        <>
          <p className="text-xs font-medium">{draft.subject}</p>
          <pre
            className="max-h-64 overflow-auto rounded-lg bg-surface p-3 font-sans text-[13px] whitespace-pre-wrap"
            data-testid="invoice-reminder-body"
          >
            {draft.body}
          </pre>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(`${draft.subject}\n\n${draft.body}`);
                toast.success(t("invoices.reminder.copied"));
              }}
            >
              {t("invoices.reminder.copy")}
            </Button>
            <a href={mailto} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("invoices.reminder.mail")}
            </a>
          </div>
        </>
      )}
    </section>
  );
}
