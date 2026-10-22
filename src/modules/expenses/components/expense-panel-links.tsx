"use client";

// The links of the expense panel, with the way to its graph.
import { Badge } from "@/components/ui/badge";
import { useT } from "@/kernel/i18n/use-t";
import { GraphLink } from "@/modules/linking/ui";
import { type ExpensePanelDetail, money } from "./expense-panel-shared";

export function ExpenseLinksSection({ detail }: { detail: ExpensePanelDetail }) {
  const t = useT();
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("expenses.panel.links")}</h3>
        <GraphLink self={{ type: "expense", id: detail.expense.id }} />
      </div>
      {detail.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("expenses.panel.noLinks")}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {detail.links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="truncate">
                <Badge variant="outline" className="mr-2">
                  {l.kind}
                </Badge>
                {l.otherLabel ?? `${l.to.type} ${l.to.id}`}
              </span>
              {l.allocatedAmount && (
                <span className="shrink-0 tabular-nums">
                  {money(l.allocatedAmount, l.currency ?? detail.expense.currency)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
