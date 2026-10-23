"use client";

// The side panel's History section (D40, F71): what happened to the row, newest first — the import, the journal
// entry's category / partner / *no document needed*, the links made. Read from the audit trail on open and after
// every save in the panel (`refreshKey`); collapsed by default like every panel's History.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { DetailsSection } from "@/kernel/ui/details-section";
import { getTransactionHistoryAction } from "@/modules/banking/banking.actions";
import type { TransactionHistoryEvent } from "@/modules/banking/types";

type T = ReturnType<typeof useT>;

/** One event in the UI language; who decided a journal change (rule, by hand…) follows a dot. */
export function historyText(t: T, e: TransactionHistoryEvent): string {
  switch (e.kind) {
    case "imported":
      return t("banking.history.imported");
    case "linked":
      return t("banking.history.linked", {
        type: t(`linking.type.${e.otherType}`),
        kind: t(`linking.kind.${e.linkKind}`),
      });
    default: {
      const what =
        e.kind === "categorised"
          ? t("banking.history.categorised", { code: e.basCode })
          : t(`banking.history.${e.kind}`);
      return e.by ? `${what} · ${t(`journal.categorisedBy.${e.by}`)}` : what;
    }
  }
}

export function TransactionHistory({
  transactionId,
  refreshKey = 0,
}: {
  transactionId: string;
  /** bumped by the panel after each save */
  refreshKey?: number;
}) {
  const t = useT();
  const lang = useUiLanguage();
  const [events, setEvents] = useState<TransactionHistoryEvent[] | null>(null);
  const { executeAsync: load } = useAction(getTransactionHistoryAction);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the panel's signal to reload
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await load({ id: transactionId });
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      // a failed read leaves the section empty — the panel's own load already toasts what went wrong
      if (live) setEvents(d ?? []);
    })();
    return () => {
      live = false;
    };
  }, [transactionId, refreshKey, load]);

  return (
    <DetailsSection title={t("details.history")} defaultOpen={false}>
      {events === null ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("banking.history.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-[13px]" data-testid="transaction-history">
          {events.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: events of one save share their moment; the list is static per load
            <li key={`${e.at}-${i}`} className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3">
              <time dateTime={e.at} className="text-muted-foreground tabular-nums">
                {formatDateTime(e.at, lang)}
              </time>
              <span className="min-w-0 break-words">{historyText(t, e)}</span>
            </li>
          ))}
        </ol>
      )}
    </DetailsSection>
  );
}
