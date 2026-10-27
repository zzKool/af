"use client";

// The side panel of one subscription (D40 details panel, F94 FR-013): loads the detail with its periods. Title: the
// name, the current state, the next expected amount. Sections: Periods (the timeline — confirm, assign, detach) ·
// About · Prices (a new price from a date closes the previous) · Pauses · Facts (for later confirms) — then
// *End* / *Reopen* and *Delete* (refused once a period has an entity).
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createClock } from "@/kernel/clock/clock";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  deleteSubscriptionAction,
  detachOccurrenceAction,
  getSubscriptionAction,
  updateSubscriptionAction,
} from "../subscriptions.actions";
import type { SubscriptionDetailWire } from "../types";
import { AssignDialog, type AssignTarget } from "./assign-dialog";
import { ConfirmPeriodDialog, type ConfirmTarget } from "./confirm-period-dialog";
import { PeriodRow } from "./period-row";
import { PeriodStateLabel } from "./period-state";
import {
  SubscriptionFacts,
  SubscriptionPauses,
  SubscriptionPrices,
} from "./subscription-panel-sections";

export function SubscriptionPanel({
  subscriptionId,
  onClose,
  canWrite,
  onChanged,
}: {
  subscriptionId: string | null;
  onClose: () => void;
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [detail, setDetail] = useState<SubscriptionDetailWire | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const { executeAsync: load } = useAction(getSubscriptionAction);
  const { executeAsync: update } = useAction(updateSubscriptionAction);
  const { executeAsync: remove } = useAction(deleteSubscriptionAction);
  const { executeAsync: detach } = useAction(detachOccurrenceAction);
  const deleteDialog = useConfirmDialog({
    title: t("subscriptions.panel.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

  const reload = useCallback(async () => {
    if (!subscriptionId) return;
    const r = await load({ id: subscriptionId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? (r.data.data as SubscriptionDetailWire) : null;
    if (d) setDetail(d);
  }, [subscriptionId, load]);

  useEffect(() => {
    setDetail(null);
    void reload();
  }, [reload]);

  function changed() {
    void reload();
    onChanged?.();
    router.refresh();
  }

  async function run(p: Promise<unknown>, done: string) {
    const error = extractError(await p);
    if (error) {
      toast.error(error);
      return false;
    }
    toast.success(done);
    changed();
    return true;
  }

  const s = detail?.subscription;
  const current = detail?.periods.find((p) => p.state !== "upcoming") ?? null;
  const next = detail?.periods.find((p) => p.state === "upcoming") ?? null;
  const today = createClock().today(); // the Stockholm day, as the services use
  const ended = !!s?.endDate && s.endDate < today;

  return (
    <Sheet open={!!subscriptionId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="subscription-panel">
        {s && detail ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span data-testid="panel-name">{s.name}</span>
                {current && <PeriodStateLabel state={current.state} marks={current.marks} />}
                {ended && <Tag>{t("subscriptions.ended")}</Tag>}
              </SheetTitle>
              {next?.price && (
                <div className="text-[22px] font-semibold tabular-nums">
                  {formatMoney(next.price.amount, next.price.currency)}
                </div>
              )}
              <SheetDescription>
                {detail.partnerName} · {t(`subscriptions.becomes.${s.becomes}`)} ·{" "}
                {t(`subscriptions.cadence.${s.cadence}`)}
                {next ? ` · ${t("subscriptions.panel.next", { date: next.date })}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col">
              <DetailsSection title={t("subscriptions.panel.periods")}>
                <ol className="divide-y divide-subtle" data-testid="period-timeline">
                  {detail.periods.map((p) => (
                    <PeriodRow
                      key={p.date}
                      period={p}
                      becomes={s.becomes}
                      canWrite={canWrite}
                      onConfirm={(pick) =>
                        setConfirmTarget({ subscriptionId: s.id, periodDate: p.date, ...pick })
                      }
                      onAssign={(kind) =>
                        setAssignTarget({ subscriptionId: s.id, periodDate: p.date, kind })
                      }
                      onDetach={(entity) =>
                        void run(
                          detach({ subscriptionId: s.id, entity }),
                          t("subscriptions.period.detached"),
                        )
                      }
                    />
                  ))}
                </ol>
              </DetailsSection>
              <DetailsSection title={t("details.about")}>
                <DetailsGrid
                  rows={[
                    [t("subscriptions.col.vendor"), detail.partnerName ?? "—"],
                    [t("subscriptions.col.category"), s.basCode],
                    [t("subscriptions.col.group"), detail.groupLabel],
                    [t("subscriptions.col.payer"), detail.payerLabel],
                    [t("subscriptions.col.start"), s.startDate],
                    [t("subscriptions.col.end"), s.endDate ?? "—"],
                    [t("subscriptions.form.tolerance"), `${s.tolerancePct} %`],
                    [t("subscriptions.form.matchText"), s.matchText ?? "—"],
                  ]}
                />
              </DetailsSection>
              <DetailsSection title={t("subscriptions.panel.prices")}>
                <SubscriptionPrices detail={detail} canWrite={canWrite} onChanged={changed} />
              </DetailsSection>
              <DetailsSection
                title={t("subscriptions.panel.pauses")}
                defaultOpen={detail.pauses.length > 0}
              >
                <SubscriptionPauses detail={detail} canWrite={canWrite} onChanged={changed} />
              </DetailsSection>
              {canWrite && (
                <DetailsSection title={t("subscriptions.panel.facts")} defaultOpen={false}>
                  <SubscriptionFacts detail={detail} onChanged={changed} />
                </DetailsSection>
              )}
            </div>

            {canWrite && (
              <div className="flex flex-wrap gap-2 border-t border-border-subtle px-4 py-3">
                {ended || s.endDate ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(
                        update({ id: s.id, patch: { endDate: null } }),
                        t("subscriptions.panel.reopened"),
                      )
                    }
                  >
                    {t("subscriptions.panel.reopen")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(
                        update({
                          id: s.id,
                          patch: { endDate: today < s.startDate ? s.startDate : today },
                        }),
                        t("subscriptions.panel.ended"),
                      )
                    }
                    data-testid="end-subscription"
                  >
                    {t("subscriptions.panel.end")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    deleteDialog.confirm(
                      async () => {
                        const r = await remove({ id: s.id });
                        const error = extractError(r);
                        if (error) throw new Error(error);
                        toast.success(t("subscriptions.panel.deleted"));
                        onClose();
                        onChanged?.();
                        router.refresh();
                      },
                      { description: t("subscriptions.panel.deleteConfirm", { name: s.name }) },
                    )
                  }
                >
                  {t("subscriptions.panel.delete")}
                </Button>
              </div>
            )}
            <ConfirmDialog {...deleteDialog.dialogProps} />
            <ConfirmPeriodDialog
              target={confirmTarget}
              onClose={() => setConfirmTarget(null)}
              onConfirmed={changed}
            />
            <AssignDialog
              target={assignTarget}
              onClose={() => setAssignTarget(null)}
              onPicked={(pick) => {
                const target = assignTarget;
                setAssignTarget(null);
                if (target)
                  setConfirmTarget({
                    subscriptionId: target.subscriptionId,
                    periodDate: target.periodDate,
                    ...pick,
                  });
              }}
            />
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>…</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
