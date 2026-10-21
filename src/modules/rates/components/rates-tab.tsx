"use client";

// Settings → Exchange rates: the ECB pairs with their newest stored day and the coverage of the last 30 days,
// and *Fetch now* for the owner — it queues the same sync job the schedule runs, then the table refreshes
// itself until the new day shows up (or 30 s pass).
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { fetchRatesNowAction, ratesStatusAction } from "@/modules/rates/rates.actions";
import type { RatePairStatus } from "@/modules/rates/types";

/** "10.750000" → "10.75" — the stored precision, without the padding. */
const trimRate = (rate: string) => rate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

const POLL_MS = 2_000;
const POLL_FOR_MS = 30_000;

export function RatesTab({ initial, canFetch }: { initial: RatePairStatus[]; canFetch: boolean }) {
  const t = useT();
  const [rows, setRows] = useState(initial);
  const [polling, setPolling] = useState(false);
  const { executeAsync: fetchNow, isPending } = useAction(fetchRatesNowAction);
  const { executeAsync: status } = useAction(ratesStatusAction);
  const before = useRef<string>("");

  const refresh = useCallback(async () => {
    const r = await status();
    if (r.data && "data" in r.data && r.data.data) setRows(r.data.data);
    return r.data && "data" in r.data ? r.data.data : null;
  }, [status]);

  // after *Fetch now*: poll until the newest day moved, or give up quietly
  useEffect(() => {
    if (!polling) return;
    const started = Date.now();
    const id = setInterval(async () => {
      const next = await refresh();
      const after = JSON.stringify(next?.map((s) => s.latestDate));
      if ((next && after !== before.current) || Date.now() - started > POLL_FOR_MS) {
        setPolling(false);
        if (next && after !== before.current) toast.success(t("rates.fetched"));
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, refresh, t]);

  async function onFetch() {
    before.current = JSON.stringify(rows.map((s) => s.latestDate));
    const r = await fetchNow();
    const error = extractError(r);
    if (error) return toast.error(error);
    const d = r.data && "data" in r.data ? r.data.data : null;
    if (!d) return;
    toast.success(d.queued ? t("rates.queued", { count: d.lastN }) : t("rates.alreadyRunning"));
    setPolling(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("rates.schedule")}</p>
        {canFetch && (
          <Button
            size="sm"
            onClick={() => void onFetch()}
            disabled={isPending || polling}
            data-testid="rates-fetch"
          >
            {polling ? t("rates.fetching") : t("rates.fetchNow")}
          </Button>
        )}
      </div>
      <Table data-testid="rates-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("rates.col.pair")}</TableHead>
            <TableHead>{t("rates.col.latest")}</TableHead>
            <TableHead className="text-right">{t("rates.col.rate")}</TableHead>
            <TableHead className="text-right">{t("rates.col.coverage")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.pair} data-testid="rates-row">
              <TableCell className="font-medium">{s.pair}</TableCell>
              <TableCell data-testid="rates-latest">
                {s.latestDate ?? <span className="text-muted-foreground">{t("rates.never")}</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.latestRate ? trimRate(s.latestRate) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.missingWeekdays === 0 ? (
                  <span className="text-green-700 dark:text-green-400">{t("rates.complete")}</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">
                    {t("rates.missing", { count: s.missingWeekdays })}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
