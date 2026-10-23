"use client";

// The links of the expense panel (Proof), with the way to its graph.
import { useT } from "@/kernel/i18n/use-t";
import { Tag } from "@/kernel/ui/tags";
import { GraphLink } from "@/modules/linking/ui";
import { type ExpensePanelDetail, money } from "./expense-panel-shared";

export function ExpenseLinksList({ detail }: { detail: ExpensePanelDetail }) {
  const t = useT();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("expenses.panel.links")}</span>
        <GraphLink self={{ type: "expense", id: detail.expense.id }} />
      </div>
      {detail.links.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("expenses.panel.noLinks")}</p>
      ) : (
        <ul className="divide-y divide-subtle rounded-md border text-[13px]">
          {detail.links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <Tag>{t(`linking.kind.${l.kind}`)}</Tag>
                <span className="truncate">{l.otherLabel ?? `${l.to.type} ${l.to.id}`}</span>
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
    </div>
  );
}
