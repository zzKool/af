"use client";

// The briefing since the last visit (feature inventory §3.14). The action items and the business pulse moved into
// the home's Next moves and cash hero (F138, `home.tsx`).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import type { BriefingLine } from "@/modules/dashboard/types";
import { briefingText } from "../briefing-label";

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
