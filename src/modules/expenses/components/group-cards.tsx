"use client";

// *This month's groups* (F154, the board *Expenses*' "Trips this month"): the groups with an expense in the latest
// month — a trip's days and country, every line with ✓ when its receipt is there and ? when it is missing, the
// per-diem line, the group's total. A card opens its group. Read only; the figures come from `groupCards`.
import { Check } from "lucide-react";
import Link from "next/link";
import { countryName } from "@/kernel/i18n/display-names";
import { formatMonth } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { StateLabel } from "@/kernel/ui/state-label";
import { Chip } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import type { GroupCard } from "../queries";
import { EXPENSES_BASE } from "./expense-table";

export function GroupCards({ month, cards }: { month: string | null; cards: GroupCard[] }) {
  const t = useT();
  const lang = useUiLanguage();
  if (!month || cards.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 pulse-card p-5" data-testid="group-cards">
      <h2 className="flex flex-wrap items-baseline gap-2 text-[15px] font-semibold">
        {t("expenses.cards.title", { month: formatMonth(month, lang) })}
        <span className="text-xs font-normal text-muted-foreground">{t("expenses.cards.sub")}</span>
      </h2>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {cards.map((g) => (
          <Link
            key={g.id}
            href={`/expenses/groups/${g.id}`}
            className="flex flex-col gap-2.5 rounded-xl border border-subtle bg-surface-2/40 p-4 hover:border-primary/40"
            data-testid="group-card"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold">{g.description}</span>
              {g.missing > 0 ? (
                <StateLabel
                  variant="chip"
                  family="attention"
                  state={t("expenses.cards.missing", { count: g.missing })}
                />
              ) : (
                <StateLabel variant="chip" family="done" state={t("expenses.cards.complete")} />
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums" data-public>
              {[
                `Ex${g.number}`,
                g.from === g.to ? g.from : `${g.from} → ${g.to}`,
                g.country ? countryName(g.country, lang) : null,
                t("expenses.cards.lines", { count: g.items.length }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.items.slice(0, 8).map((i) => (
                <Chip
                  key={i.id}
                  tone={i.perDiem ? "info" : "neutral"}
                  className={cn(
                    "max-w-56",
                    !i.hasDocument && !i.perDiem && "bg-state-attention/12 text-state-attention",
                  )}
                >
                  <span className="truncate" title={`${i.key} · ${i.description}`}>
                    {i.description}
                  </span>
                  {i.perDiem ? null : i.hasDocument ? (
                    <Check aria-label={t("expenses.cards.receipt")} className="size-3" />
                  ) : (
                    <span>
                      <span aria-hidden>?</span>
                      <span className="sr-only">{t("expenses.cards.noReceipt")}</span>
                    </span>
                  )}
                </Chip>
              ))}
              {g.items.length > 8 && <Chip>+{g.items.length - 8}</Chip>}
            </div>
            <div className="mt-auto flex items-baseline justify-between text-[13px]">
              <span className="text-muted-foreground">{t("expenses.cards.total")}</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(g.totalBase, EXPENSES_BASE)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
