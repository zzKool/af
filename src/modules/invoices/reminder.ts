// The reminder drafted when late (F143, Pulse phase 7; the board *Invoice studio*: "draft a reminder if it is not
// paid 3 days after the due date"): a friendly payment reminder in the **document's** language, ready to copy or
// to open in the mail app — nothing is sent by the app. Pure, client-safe.
import { addDays, daysUntil } from "@/kernel/clock/calendar";

/** Days after the due date before the reminder is offered. */
export const REMINDER_GRACE_DAYS = 3;

export type ReminderFacts = {
  number: string;
  issueDate: string;
  dueDate: string;
  /** what is still open, as printed (`CHF 9'600.00`) */
  open: string;
  clientName: string;
  companyName: string;
  ownerName: string | null;
};

/** Offered from the grace day on, while something is open. */
export function reminderDue(dueDate: string | null, today: string, open: boolean): boolean {
  return !!dueDate && open && today >= addDays(dueDate, REMINDER_GRACE_DAYS);
}

export type ReminderKey =
  | "invoice.reminder.subject"
  | "invoice.reminder.greeting"
  | "invoice.reminder.line1"
  | "invoice.reminder.line2"
  | "invoice.reminder.thanks"
  | "invoice.reminder.closing";

/** Subject and body in the document's language (`t` = the document language's translator). */
export function reminderDraft(
  f: ReminderFacts,
  today: string,
  t: (key: ReminderKey, params?: Record<string, string | number>) => string,
): { subject: string; body: string; daysLate: number } {
  const daysLate = Math.max(0, daysUntil(f.dueDate, today));
  const p = {
    number: f.number,
    issueDate: f.issueDate,
    dueDate: f.dueDate,
    open: f.open,
    client: f.clientName,
    company: f.companyName,
    owner: f.ownerName ?? f.companyName,
    days: daysLate,
  };
  return {
    subject: t("invoice.reminder.subject", p),
    body: [
      t("invoice.reminder.greeting", p),
      "",
      t("invoice.reminder.line1", p),
      t("invoice.reminder.line2", p),
      "",
      t("invoice.reminder.thanks", p),
      "",
      t("invoice.reminder.closing", p),
      // signed by the owner and the company — once when no owner's name is known
      ...(p.owner === p.company ? [p.company] : [p.owner, p.company]),
    ].join("\n"),
    daysLate,
  };
}
