"use client";

// Work — the monthly close (F137, spec US4; the board *Pulse · Work*, D77): the invoice reminder, the progress line
// of the owner's four steps and the package, the open step's card with its facts and the action that moves it,
// *Also waiting* (the dashboard's other items) and *Past months* with the streak. Everything is derived (FR-004);
// the page only chooses which step's card is open.
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatMonth } from "@/kernel/i18n/format-date";
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { type StateFamily, StateIcon, StateLabel } from "@/kernel/ui/state-label";
import { cn } from "@/lib/utils";
import type {
  ActionItem,
  CloseStep,
  CloseStepState,
  MonthlyClose,
  PastClose,
} from "@/modules/dashboard/types";
import { PRIORITY_FAMILY } from "../priority-family";

/** a step's state → its family (done · in progress · not finished · waiting) */
const FAMILY: Record<CloseStepState, StateFamily> = {
  done: "done",
  current: "progress",
  todo: "attention",
  waiting: "neutral",
};

const CARD = "rounded-2xl border border-subtle bg-surface shadow-card";

type T = (key: MessageKey, params?: MessageParams) => string;

/** What a step's card says: the short line under the node, the sentence, the facts, the actions. */
function stepWords(step: CloseStep, close: MonthlyClose, month: string, t: T) {
  const left = step.total - step.done;
  switch (step.kind) {
    case "rates": {
      const done = step.state === "done";
      return {
        short: done
          ? t("work.rates.short.done")
          : t("work.rates.short.open", { count: close.rates.missing }),
        text: done
          ? t("work.rates.text.done", { month })
          : t("work.rates.text.open", {
              count: close.rates.missing,
              total: close.rates.weekdays,
              month,
            }),
        facts: [t("work.rates.fact", { done: step.done, total: step.total })],
        actions: [{ label: t("work.rates.action"), href: step.href }],
      };
    }
    case "statements":
      return {
        short: t("work.statements.short", { done: step.done, total: step.total }),
        text:
          step.total === 0
            ? t("work.statements.text.none")
            : step.state === "done"
              ? t("work.statements.text.done", { month })
              : t("work.statements.text.open", { count: left, month }),
        facts: close.accounts.map((a) =>
          a.completeTo
            ? t("work.statements.fact", { account: a.label, date: a.completeTo })
            : t("work.statements.factNone", { account: a.label }),
        ),
        actions: [{ label: t("work.statements.action"), href: step.href }],
      };
    case "justified": {
      const done = step.state === "done";
      return {
        short: done
          ? t("work.justified.short.done", { total: step.total })
          : step.total === 0
            ? t("work.justified.short.empty")
            : t("work.justified.short.open", { done: step.done, total: step.total, count: left }),
        text: done
          ? t("work.justified.text.done", { month })
          : step.total === 0
            ? t("work.justified.text.empty", { month })
            : t("work.justified.text.open", { count: left, month }),
        facts: [
          t("work.justified.factDone", { count: step.done }),
          t("work.justified.factOpen", { count: left }),
        ],
        actions: done
          ? [{ label: t("work.justified.actionDone"), href: step.href }]
          : [
              { label: t("work.justified.inbox"), href: "/banking/inbox", secondary: true },
              { label: t("work.justified.action", { count: left }), href: step.href },
            ],
      };
    }
    case "expenses":
      return {
        short: t("work.expenses.short", { count: close.privateExpenses }),
        text:
          step.state === "done"
            ? t("work.expenses.text.done", { count: close.privateExpenses, month })
            : t("work.expenses.text.open", { count: close.privateExpenses, month }),
        facts: [t("work.expenses.fact", { count: close.privateExpenses })],
        actions: [{ label: t("work.expenses.action"), href: step.href }],
      };
    case "closed":
      return {
        short: close.builtOn
          ? t("work.closed.short.done", { date: close.builtOn })
          : t("work.closed.short.open"),
        text: close.builtOn
          ? t("work.closed.text.done", { month, date: close.builtOn })
          : step.state === "waiting"
            ? t("work.closed.text.waiting")
            : t("work.closed.text.current", { month }),
        facts: step.state === "waiting" ? [t("work.closed.factWaiting")] : [],
        actions: [{ label: t("work.closed.action"), href: step.href }],
      };
  }
}

/** The month switch ‹ Jun · Aug › — links, so the month is in the address. */
export function WorkMonthNav({ close }: { close: MonthlyClose }) {
  const t = useT();
  const lang = useUiLanguage();
  const link = (month: string | null, label: string, aria: string, text: string) =>
    month ? (
      <Link
        href={`/work?month=${month}`}
        aria-label={aria}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        {text}
      </Link>
    ) : (
      <Button variant="outline" size="sm" disabled aria-label={aria}>
        {label}
      </Button>
    );
  const short = (m: string | null) => (m ? formatMonth(m, lang, "short") : "");
  return (
    <div className="flex gap-1.5" data-testid="work-month-nav">
      {link(close.previous, "‹", t("work.previous"), `‹ ${short(close.previous)}`)}
      {link(close.next, "›", t("work.next"), `${short(close.next)} ›`)}
    </div>
  );
}

export function MonthlyCloseView({
  close,
  past,
  streak,
  alsoWaiting,
}: {
  close: MonthlyClose;
  past: PastClose[];
  streak: number;
  alsoWaiting: ActionItem[];
}) {
  const t = useT();
  const lang = useUiLanguage();
  const month = formatMonth(close.month, lang);
  const firstOpen = close.steps.findIndex((s) => s.state === "current");
  const [open, setOpen] = useState(firstOpen >= 0 ? firstOpen : close.steps.length - 1);
  const step = close.steps[open] ?? close.steps[0];
  const card = step ? stepWords(step, close, month, t) : null;
  const doneCount = close.steps.filter((s) => s.state === "done").length;
  // the line's filled part reaches the last done node in a row from the start
  const reached = close.steps.findIndex((s) => s.state !== "done");
  const filled = reached < 0 ? close.steps.length - 1 : reached;

  return (
    <div className="flex flex-col gap-4" data-testid="work-page" data-month={close.month}>
      {close.reminders.map((r) => (
        <div
          key={r.partnerId}
          data-testid="work-reminder"
          className={cn(
            CARD,
            "flex flex-wrap items-center gap-4 border-state-attention/30 bg-state-attention/6 px-5 py-4",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">
              {t("work.reminder.title", { partner: r.partnerName, month })}
            </div>
            <div className="text-[12.5px] text-muted-foreground">
              {t("work.reminder.text", { partner: r.partnerName, date: r.lastIssueDate })}
            </div>
          </div>
          <Link href="/invoices/new" className={buttonVariants()}>
            {t("work.reminder.action")}
          </Link>
        </div>
      ))}

      <section
        className={cn(CARD, "flex flex-col gap-5 px-6 pt-6 pb-5")}
        aria-label={t("work.steps")}
        data-testid="work-steps"
        data-done={doneCount}
      >
        <div className="relative flex items-start gap-2">
          <div
            className="absolute top-[22px] right-[10%] left-[10%] h-1 rounded-full bg-surface-2"
            aria-hidden
          />
          <div
            className="absolute top-[22px] left-[10%] h-1 rounded-full bg-state-done"
            style={{ width: `${(filled / (close.steps.length - 1)) * 80}%` }}
            aria-hidden
          />
          {close.steps.map((s, i) => {
            const d = stepWords(s, close, month, t);
            return (
              <button
                key={s.kind}
                type="button"
                onClick={() => setOpen(i)}
                aria-pressed={open === i}
                data-step={s.kind}
                data-state={s.state}
                className={cn(
                  "relative flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl px-1 py-1 text-center",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  open === i && "bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-[46px] items-center justify-center rounded-full border-2 text-[15px] font-semibold",
                    s.state === "done" && "border-state-done bg-state-done text-surface",
                    s.state === "current" &&
                      "border-state-progress bg-surface text-state-progress ring-4 ring-state-progress/15",
                    s.state === "todo" && "border-state-attention bg-surface text-state-attention",
                    s.state === "waiting" && "border-subtle bg-surface-2 text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {s.state === "done" ? "✓" : s.kind === "closed" ? "⚑" : i + 1}
                </span>
                <span className="text-[13px] font-semibold">{t(`work.${s.kind}.title`)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{d.short}</span>
              </button>
            );
          })}
        </div>

        {step && card && (
          <div
            className="flex flex-wrap items-center gap-4 rounded-2xl border border-subtle bg-surface-2 px-5 py-4"
            data-testid="work-step-card"
            data-step={step.kind}
          >
            <div className="flex min-w-[min(100%,24rem)] flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t("work.step", { n: open + 1 })}
                </span>
                <StateLabel
                  variant="chip"
                  family={FAMILY[step.state]}
                  state={t(`work.state.${step.state}`)}
                />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t(`work.${step.kind}.title`)}
              </h2>
              <p className="text-sm text-muted-foreground">{card.text}</p>
              {card.facts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {card.facts.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-tag px-2.5 py-0.5 text-[11.5px] text-muted-foreground tabular-nums"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {card.actions.map((a) => (
                <Link
                  key={a.href + a.label}
                  href={a.href}
                  className={buttonVariants({
                    variant: "secondary" in a && a.secondary ? "outline" : "default",
                  })}
                >
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        <section className={cn(CARD, "flex flex-col gap-2.5 p-5")} data-testid="work-also">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[17px] font-semibold">{t("work.also.title")}</h2>
            <span className="text-xs text-muted-foreground">{t("work.also.sub")}</span>
          </div>
          {alsoWaiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("work.also.none")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-subtle">
              {alsoWaiting.map((item) => (
                <li
                  key={item.id}
                  data-testid="work-also-item"
                  data-kind={item.kind}
                  className="flex items-center gap-3 py-2.5"
                >
                  <StateIcon family={PRIORITY_FAMILY[item.priority]} />
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {t(`dashboard.action.${item.kind}`, {
                      count: item.count,
                      period: item.period ?? "",
                      ...item.params,
                    })}
                  </span>
                  {item.amount && (
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {formatMoney(item.amount.value, item.amount.currency)}
                    </span>
                  )}
                  <Link
                    href={item.href}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {t("work.also.open")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className={cn(CARD, "flex flex-col gap-2 p-5")} data-testid="work-past">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[17px] font-semibold">{t("work.past.title")}</h2>
            {streak > 0 && (
              <span className="ml-auto" data-testid="work-streak">
                <StateLabel
                  variant="chip"
                  family="done"
                  state={t("work.past.streak", { count: streak })}
                />
              </span>
            )}
          </div>
          {past.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("work.past.none")}</p>
          ) : (
            past.map((m) => (
              <Link
                key={m.month}
                href={`/work?month=${m.month}`}
                data-testid="work-past-month"
                data-month={m.month}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 text-[13px] hover:bg-hover"
              >
                <span className="w-[4.75rem] font-medium">
                  {formatMonth(m.month, lang, "short")}
                </span>
                <span
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
                  aria-hidden
                >
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      m.builtOn ? "bg-state-done" : "bg-state-attention",
                    )}
                    style={{ width: `${m.builtOn ? 100 : m.percent}%` }}
                  />
                </span>
                <span className="w-[7rem] text-right text-muted-foreground tabular-nums">
                  {m.builtOn
                    ? t("work.past.closed", { date: m.builtOn })
                    : t("work.past.open", { percent: m.percent })}
                </span>
              </Link>
            ))
          )}
          <p className="mt-auto pt-2 text-xs text-muted-foreground">{t("work.past.note")}</p>
        </aside>
      </div>
    </div>
  );
}
