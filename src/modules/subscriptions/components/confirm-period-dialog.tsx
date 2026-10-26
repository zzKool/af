"use client";

// The confirm (F94 FR-008, US3, US4): what the period will become, from what was found — the receipt's / bill's facts
// first, the bank row's next, the subscription's for the rest — editable, then one server action: the entity, the
// row attached, `occurrence_of`, in one transaction. A period that already has its entity is *completed* instead
// (the receipt after the charge, the charge after the receipt). Q1 A: a foreign-currency charge waits for its receipt.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { InfoBanner } from "@/kernel/ui/info-banner";
import { CodeChip } from "@/kernel/ui/tags";
import type { ConfirmFacts, ConfirmPrefill } from "../confirm";
import { confirmPeriodAction, confirmPrefillAction } from "../subscriptions.actions";

export type ConfirmTarget = {
  subscriptionId: string;
  periodDate: string;
  bankTransactionId?: string;
  documentId?: string;
};

const label = "mb-1 block text-xs font-medium";

export function ConfirmPeriodDialog({
  target,
  onClose,
  onConfirmed,
}: {
  target: ConfirmTarget | null;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const t = useT();
  const ids = useId();
  const [prefill, setPrefill] = useState<ConfirmPrefill | null>(null);
  const [facts, setFacts] = useState<ConfirmFacts | null>(null);
  const [ackNote, setAckNote] = useState("");
  const { executeAsync: load } = useAction(confirmPrefillAction);
  const { executeAsync: run, isPending } = useAction(confirmPeriodAction);

  useEffect(() => {
    setPrefill(null);
    setFacts(null);
    setAckNote("");
    if (!target) return;
    let live = true;
    void load(target).then((r) => {
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      const d = r?.data && "data" in r.data ? (r.data.data as ConfirmPrefill) : null;
      if (live && d) {
        setPrefill(d);
        setFacts(d.facts);
      }
    });
    return () => {
      live = false;
    };
  }, [target, load]);

  const high = (prefill?.duplicates ?? []).filter((d) => d.confidence === "high");
  const set = (k: keyof ConfirmFacts, v: string) =>
    setFacts((f) => (f ? { ...f, [k]: v === "" ? null : v } : f));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !prefill) return;
    const r = await run({
      ...target,
      ...(facts && !prefill.entity ? { facts } : {}),
      ...(high.length > 0 && ackNote.trim()
        ? { duplicateAck: { entityIds: high.map((d) => d.entityId), note: ackNote.trim() } }
        : {}),
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const key = r?.data && "data" in r.data ? r.data.data?.entity.key : "";
    toast.success(t("subscriptions.confirm.done", { key: key ?? "" }));
    onConfirmed();
    onClose();
  }

  const bill = prefill?.becomes === "supplier_invoice";
  const blocked =
    !prefill ||
    (!prefill.entity && (!facts || prefill.waitingFor !== null)) ||
    (high.length > 0 && !ackNote.trim());

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="confirm-period-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {prefill?.entity
              ? t("subscriptions.confirm.completeTitle", { key: prefill.entity.key })
              : t("subscriptions.confirm.title", { date: target?.periodDate ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {prefill?.entity
              ? t("subscriptions.confirm.completeDescription")
              : t("subscriptions.confirm.description", {
                  becomes: t(`subscriptions.becomes.${prefill?.becomes ?? "expense"}`),
                })}
          </DialogDescription>
        </DialogHeader>
        {!prefill ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          <form className="grid gap-3" onSubmit={(e) => void submit(e)}>
            {prefill.waitingFor && !prefill.entity && (
              <InfoBanner>
                {prefill.waitingFor === "bill"
                  ? t("subscriptions.confirm.waitingBill")
                  : t("subscriptions.confirm.waitingReceipt")}
              </InfoBanner>
            )}
            {prefill.entity && (
              <div className="flex items-center gap-2 text-sm">
                <CodeChip>{prefill.entity.key}</CodeChip>
                <span className="tabular-nums">
                  {formatMoney(prefill.entity.amount, prefill.entity.currency)}
                </span>
                <span className="text-muted-foreground">
                  {target?.documentId ? t("subscriptions.confirm.attachReceipt") : null}
                  {target?.documentId && target.bankTransactionId ? " · " : null}
                  {target?.bankTransactionId ? t("subscriptions.confirm.attachRow") : null}
                </span>
              </div>
            )}
            {prefill.amountWarning && prefill.entity && (
              <InfoBanner>
                {t("subscriptions.confirm.amountWarning", { key: prefill.entity.key })}
              </InfoBanner>
            )}
            {facts && !prefill.entity && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`${ids}-date`} className={label}>
                      {bill
                        ? t("subscriptions.confirm.invoiceDate")
                        : t("subscriptions.confirm.date")}
                    </label>
                    <Input
                      id={`${ids}-date`}
                      type="date"
                      value={facts.date}
                      onChange={(e) => set("date", e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_4.5rem] gap-2">
                    <div>
                      <label htmlFor={`${ids}-amount`} className={label}>
                        {bill
                          ? t("subscriptions.confirm.total")
                          : t("subscriptions.confirm.amount")}
                      </label>
                      <Input
                        id={`${ids}-amount`}
                        value={facts.amount}
                        onChange={(e) => set("amount", e.target.value)}
                        className="tabular-nums"
                        required
                        data-testid="confirm-amount"
                      />
                    </div>
                    <div>
                      <span className={label}>{t("subscriptions.form.currency")}</span>
                      <div className="flex h-8 items-center text-sm" data-testid="confirm-currency">
                        {facts.currency}
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <label htmlFor={`${ids}-desc`} className={label}>
                    {t("subscriptions.confirm.descriptionField")}
                  </label>
                  <Input
                    id={`${ids}-desc`}
                    value={facts.description}
                    onChange={(e) => set("description", e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {bill && (
                    <div>
                      <label htmlFor={`${ids}-net`} className={label}>
                        {t("subscriptions.confirm.net")}
                      </label>
                      <Input
                        id={`${ids}-net`}
                        value={facts.amountNet ?? ""}
                        onChange={(e) => set("amountNet", e.target.value)}
                        className="tabular-nums"
                      />
                    </div>
                  )}
                  <div>
                    <label htmlFor={`${ids}-vat`} className={label}>
                      {t("subscriptions.confirm.vat")}
                    </label>
                    <Input
                      id={`${ids}-vat`}
                      value={facts.vatAmount ?? ""}
                      onChange={(e) => set("vatAmount", e.target.value)}
                      className="tabular-nums"
                    />
                  </div>
                </div>
                {bill && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`${ids}-number`} className={label}>
                        {t("subscriptions.confirm.invoiceNumber")}
                      </label>
                      <Input
                        id={`${ids}-number`}
                        value={facts.invoiceNumber ?? ""}
                        onChange={(e) => set("invoiceNumber", e.target.value)}
                        required
                        data-testid="confirm-invoice-number"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${ids}-due`} className={label}>
                        {t("subscriptions.confirm.dueDate")}
                      </label>
                      <Input
                        id={`${ids}-due`}
                        type="date"
                        value={facts.dueDate ?? ""}
                        onChange={(e) => set("dueDate", e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            {high.length > 0 && (
              <div className="grid gap-1">
                <InfoBanner>
                  {t("subscriptions.confirm.duplicates", {
                    keys: high.map((d) => d.entityKey).join(", "),
                  })}
                </InfoBanner>
                <label htmlFor={`${ids}-ack`} className={label}>
                  {t("subscriptions.confirm.ackNote")}
                </label>
                <Input
                  id={`${ids}-ack`}
                  value={ackNote}
                  onChange={(e) => setAckNote(e.target.value)}
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={blocked || isPending}
                data-testid="confirm-period-submit"
              >
                {t("subscriptions.confirm.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
