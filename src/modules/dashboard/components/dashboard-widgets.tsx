"use client";

// The dashboard's three widgets (feature inventory §3.14): the action items — one line each, the figure, the page
// that resolves it — the business pulse, and the briefing since the last visit. Strings from the dictionary; money
// formatted at the display boundary.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import type { ActionItem, BriefingLine, PulseMetric } from "@/modules/dashboard/types";
import { briefingText } from "../briefing-label";

const PRIORITY_STYLE: Record<ActionItem["priority"], string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  low: "bg-muted text-muted-foreground",
};

const money = (value: string, currency: string) =>
  `${formatCurrency(value, currency as Currency)} ${currency}`;

export function ActionItemsWidget({ items }: { items: ActionItem[] }) {
  const t = useT();
  return (
    <Card data-testid="action-items">
      <CardHeader>
        <CardTitle>{t("dashboard.actions.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dashboard.actions.none")}</p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} data-testid="action-item" data-kind={item.kind}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 py-2 hover:bg-muted/50 -mx-2 px-2 rounded-md"
                >
                  <Badge variant="outline" className={PRIORITY_STYLE[item.priority]}>
                    {item.count}
                  </Badge>
                  <span className="min-w-0 flex-1 text-sm">
                    {t(`dashboard.action.${item.kind}`, {
                      count: item.count,
                      period: item.period ?? "",
                    })}
                    {item.amount && (
                      <span className="ml-1 text-muted-foreground tabular-nums">
                        · {money(item.amount.value, item.amount.currency)}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function BusinessPulseWidget({ metrics }: { metrics: PulseMetric[] }) {
  const t = useT();
  return (
    <Card data-testid="business-pulse">
      <CardHeader>
        <CardTitle>{t("dashboard.pulse.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.id} data-testid="pulse-metric" data-kind={m.kind}>
              <dt className="truncate text-xs text-muted-foreground">
                {m.kind === "balance" ? m.label : t(`dashboard.pulse.${m.kind}`)}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                <Link href={m.href}>{money(m.value, m.currency)}</Link>
              </dd>
              {m.hint && (
                <dd className="text-xs text-muted-foreground">
                  {m.kind === "balance"
                    ? t("dashboard.pulse.asOf", { date: m.hint })
                    : m.kind === "invoicedYear"
                      ? m.hint
                      : t("dashboard.pulse.open", { count: m.hint })}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function BriefingWidget({ since, lines }: { since: string | null; lines: BriefingLine[] }) {
  const t = useT();
  const lang = useUiLanguage();
  return (
    <Card data-testid="briefing">
      <CardHeader>
        <CardTitle>
          {since
            ? t("dashboard.briefing.since", {
                date: formatDateTime(since, lang),
              })
            : t("dashboard.briefing.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {since ? t("dashboard.briefing.quiet") : t("dashboard.briefing.first")}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {lines.map((l) => (
              <li
                key={`${l.entityType}:${l.action}`}
                className="rounded-md border px-2 py-1 text-sm"
                data-testid="briefing-line"
              >
                <span className="font-medium tabular-nums">{l.count}</span>{" "}
                <span className="text-muted-foreground">{briefingText(t, l)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
