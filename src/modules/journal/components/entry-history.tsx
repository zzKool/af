"use client";

// The panel's History (F71, D40: About · Proof · form · History, collapsed): the entry's audit trail, newest first —
// when it was created (import or *New entry*) and each later change of the owner's facts, by hand or by a rule.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsSection } from "@/kernel/ui/details-section";
import { journalEntryHistoryAction } from "@/modules/journal/journal.actions";
import type { JournalFact, JournalHistoryItem } from "@/modules/journal/types";

const FACT_LABEL = {
  basCode: "journal.form.category",
  partnerId: "journal.form.partner",
  note: "journal.form.note",
  noDocumentNeeded: "journal.form.noDocument",
} as const satisfies Record<JournalFact, string>;

const pad = (n: number) => String(n).padStart(2, "0");

/** `yyyy-mm-dd hh:mm` in the viewer's time zone — the D40 date, with the time a trail needs. */
export function historyStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EntryHistory({ entryId }: { entryId: string }) {
  const t = useT();
  const [items, setItems] = useState<JournalHistoryItem[] | null>(null);
  const { executeAsync: load } = useAction(journalEntryHistoryAction);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    void (async () => {
      const r = await load({ id: entryId });
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (!cancelled) setItems(d ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, load]);

  return (
    <DetailsSection title={t("details.history")} defaultOpen={false}>
      <div data-testid="journal-history" className="text-[13px]">
        {items === null ? (
          <p className="text-muted-foreground">…</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">{t("journal.history.empty")}</p>
        ) : (
          <ol className="grid gap-1">
            {items.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a trail is positional (two writes can share a second)
              <li key={i} className="flex gap-2" data-testid="journal-history-item">
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {historyStamp(h.at)}
                </span>
                <span className="min-w-0">
                  {t(`journal.history.${h.action}`)}
                  {h.changed.length > 0 &&
                    ` · ${h.changed.map((f) => t(FACT_LABEL[f])).join(", ")}`}
                  {h.by === "rule" && (
                    <span className="text-muted-foreground"> · {t("journal.history.byRule")}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </DetailsSection>
  );
}
