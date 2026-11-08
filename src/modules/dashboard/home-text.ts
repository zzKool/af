// The home's situation sentence (F138, FR-008): what is late, then where the month's close stands and its next
// step. Pure and server-safe — the page says it in the hero.
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import type { ActionItem, CloseStepKind, MonthlyClose } from "./types";

type T = (key: MessageKey, params?: MessageParams) => string;

export function homeSentence(
  items: readonly ActionItem[],
  close: MonthlyClose | null,
  month: string,
  t: T,
): string {
  const late = items.filter((i) => i.priority === "high").length;
  const first = late > 0 ? t("home.sentence.late", { count: late }) : t("home.sentence.notLate");
  if (!close) return first;
  const step = close.steps.find((s) => s.state === "current" || s.state === "waiting");
  if (!step) return `${first} ${t("home.sentence.closed", { month })}`;
  const left = step.total - step.done;
  const part: Record<CloseStepKind, () => string> = {
    rates: () => t("work.left.rates", { count: close.rates.missing }),
    statements: () => t("work.left.statements", { count: left }),
    justified: () => (left > 0 ? t("work.left.justified", { count: left }) : t("work.left.rows")),
    expenses: () => t("work.left.expenses"),
    closed: () => t("work.left.closed"),
  };
  return `${first} ${t("home.sentence.close", { month, percent: close.percent, left: part[step.kind]() })}`;
}
