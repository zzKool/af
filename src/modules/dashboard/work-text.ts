// The words of Work's header (F137): the sentence under the title — what is left, in a few words. Pure and
// server-safe (the page says it in its header); the step cards say the rest.
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import type { CloseStepKind, MonthlyClose } from "./types";

type T = (key: MessageKey, params?: MessageParams) => string;

export function leftSentence(close: MonthlyClose, month: string, t: T): string {
  const open = close.steps.filter((s) => s.state !== "done");
  if (open.length === 0) return t("work.left.none", { month, date: close.builtOn ?? "" });
  const part: Record<CloseStepKind, (left: number) => string> = {
    rates: () => t("work.left.rates", { count: close.rates.missing }),
    statements: (left) => t("work.left.statements", { count: left }),
    // no row yet (the statements first): the rows, not "0 to justify"
    justified: (left) =>
      left > 0 ? t("work.left.justified", { count: left }) : t("work.left.rows"),
    expenses: () => t("work.left.expenses"),
    closed: () => t("work.left.closed"),
  };
  const parts = open.map((s) => part[s.kind](s.total - s.done));
  return t("work.left.some", { count: open.length, list: parts.join(", ") });
}
