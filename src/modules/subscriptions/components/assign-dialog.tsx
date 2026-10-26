"use client";

// *Assign a row… / Assign a receipt…* (F94 FR-009, US3-9): when nothing matched — the price changed, the text differs —
// the owner picks any open outgoing row of the payer's account in the period's window, or any inbox document dated
// within a month; the confirm then runs as for a match.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import type { PeriodCandidates } from "../confirm";
import { periodCandidatesAction } from "../subscriptions.actions";

export type AssignTarget = {
  subscriptionId: string;
  periodDate: string;
  kind: "row" | "document";
};

export function AssignDialog({
  target,
  onClose,
  onPicked,
}: {
  target: AssignTarget | null;
  onClose: () => void;
  onPicked: (pick: { bankTransactionId?: string; documentId?: string }) => void;
}) {
  const t = useT();
  const [data, setData] = useState<PeriodCandidates | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const { executeAsync: load } = useAction(periodCandidatesAction);

  useEffect(() => {
    setData(null);
    setPick(null);
    if (!target) return;
    let live = true;
    void load({ subscriptionId: target.subscriptionId, periodDate: target.periodDate }).then(
      (r) => {
        const error = extractError(r);
        if (error) return void toast.error(error);
        const d = r?.data && "data" in r.data ? (r.data.data as PeriodCandidates) : null;
        if (live) setData(d);
      },
    );
    return () => {
      live = false;
    };
  }, [target, load]);

  const items =
    target?.kind === "row"
      ? (data?.rows ?? []).map((r) => ({
          id: r.id,
          text: `${r.bookingDate} · ${formatMoney(r.amount, r.currency)} · ${r.description}`,
        }))
      : (data?.documents ?? []).map((d) => ({
          id: d.id,
          text: `${d.date ?? "—"} · ${d.businessKey || d.fileName}${d.vendorName ? ` · ${d.vendorName}` : ""}${
            d.total && d.currency ? ` · ${formatMoney(d.total, d.currency)}` : ""
          }`,
        }));

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="assign-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target?.kind === "row"
              ? t("subscriptions.assign.titleRow")
              : t("subscriptions.assign.titleDocument")}
          </DialogTitle>
          <DialogDescription>{target?.periodDate}</DialogDescription>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("subscriptions.assign.none")}</p>
        ) : (
          <fieldset className="grid max-h-72 gap-1 overflow-y-auto text-[13px]">
            <legend className="sr-only">{t("subscriptions.assign.pick")}</legend>
            {items.map((i) => (
              <label
                key={i.id}
                className="flex items-center gap-2 rounded px-1 py-1 hover:bg-hover"
              >
                <input
                  type="radio"
                  name="assign"
                  value={i.id}
                  checked={pick === i.id}
                  onChange={() => setPick(i.id)}
                />
                <span className="truncate tabular-nums">{i.text}</span>
              </label>
            ))}
          </fieldset>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!pick}
            data-testid="assign-continue"
            onClick={() => {
              if (!pick || !target) return;
              onPicked(target.kind === "row" ? { bankTransactionId: pick } : { documentId: pick });
            }}
          >
            {t("subscriptions.assign.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
