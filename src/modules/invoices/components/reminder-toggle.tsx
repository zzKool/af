"use client";

// F169, the board *Invoice studio*: "Draft a reminder if it is not paid 3 days after the due date" — a switch per
// invoice, on by default. On, the page drafts the reminder when the invoice is late and open (`ReminderCard`); off, it
// does not. The app sends nothing: there is no mail behind the switch, only whether the reminder is drafted.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import { setInvoiceReminderAction } from "@/modules/invoices/invoices.actions";
import { REMINDER_GRACE_DAYS } from "../reminder";

export function ReminderToggle({
  id,
  on,
  disabled,
  className,
}: {
  id: string;
  on: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const { executeAsync, isPending } = useAction(setInvoiceReminderAction);
  // shown at once, put back when the save is refused
  const [value, setValue] = useState(on);
  const label = t("invoices.reminderSwitch.label", { days: REMINDER_GRACE_DAYS });
  const flip = async () => {
    const next = !value;
    setValue(next);
    const r = await executeAsync({ id, remindWhenLate: next });
    const error = extractError(r);
    if (error) {
      setValue(!next);
      toast.error(error);
      return;
    }
    router.refresh();
  };
  return (
    <label
      className={cn("flex cursor-pointer items-center gap-2.5", className)}
      data-testid="invoice-reminder-switch"
    >
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled || isPending}
        onClick={flip}
        className={cn(
          "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-60",
          value ? "bg-state-done" : "bg-surface-2 ring-1 ring-border ring-inset",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-[3px] size-4 rounded-full bg-surface shadow-card transition-[left]",
            value ? "left-[19px]" : "left-[3px]",
          )}
        />
      </button>
      <span className="text-[12.5px] text-foreground/80">{label}</span>
    </label>
  );
}
