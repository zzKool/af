"use client";

// The Rates section of one contract (specs/contracts US1, US3): dated history, inline add, edit-in-place,
// delete with confirm. Lives inside the contract's expanded row on the partner page — no route of its own.
// States (Current / Expired / Future) come from the server, derived against today; never stored — shown as a
// D40 <StateLabel> through the module's one map (state-family.ts). Amounts through formatMoney (F71).
import { useAction } from "next-safe-action/hooks";
import { useCallback, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AppError } from "@/kernel/errors/app-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { RowActionsMenu } from "@/kernel/ui/data-table";
import { DetailsSection } from "@/kernel/ui/details-section";
import { StateLabel } from "@/kernel/ui/state-label";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  createContractRateAction,
  deleteContractRateAction,
  getContractRatesAction,
  updateContractRateAction,
} from "@/modules/contracts/contracts.actions";
import { rateErrorText } from "@/modules/contracts/rate-error";
import { rateStateFamily } from "@/modules/contracts/state-family";
import type { RateState, RateUnit } from "@/modules/contracts/types";

/** What the page hands over: calendar dates and the decimal as strings, state from the server. */
export type ContractRateRow = {
  id: string;
  validFrom: string;
  validTo: string | null;
  rate: string;
  unit: RateUnit;
  note: string | null;
  state: RateState;
};

type ActionResult = { serverError?: { message?: string }; data?: { error?: AppError } } | undefined;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ContractRates({
  contractId,
  currency,
  rates: initialRates,
  onRatesChange,
}: {
  contractId: string;
  currency: string | null;
  rates: ContractRateRow[];
  /** Called with the fresh list after every change so the parent can derive the current rate. */
  onRatesChange?: (contractId: string, rates: ContractRateRow[]) => void;
}) {
  const t = useT();
  const ids = useId();
  const [rates, setRates] = useState<ContractRateRow[]>(initialRates);
  const [adding, setAdding] = useState(false);
  const [newFrom, setNewFrom] = useState(todayIso);
  const [newTo, setNewTo] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newNote, setNewNote] = useState("");

  const { executeAsync: execList } = useAction(getContractRatesAction);
  const { executeAsync: execCreate, isPending: isCreating } = useAction(createContractRateAction);
  const { executeAsync: execUpdate } = useAction(updateContractRateAction);
  const { executeAsync: execDelete } = useAction(deleteContractRateAction);
  const { dialogProps, confirm } = useConfirmDialog({
    title: t("contracts.rates.deleteConfirm.title"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

  /** The server's message is English; when it carries details we render the user's language (`rate-error.ts`). */
  const errorText = useCallback(
    (result: ActionResult): string | null => {
      if (!result) return null;
      if (result.serverError) return result.serverError.message ?? t("errors.generic");
      const err = result.data?.error;
      return err ? rateErrorText(err, t) : null;
    },
    [t],
  );

  const reload = useCallback(async () => {
    const r = await execList({ contractId });
    const list = r?.data?.data ?? [];
    setRates(list);
    onRatesChange?.(contractId, list);
  }, [contractId, execList, onRatesChange]);

  const handleAdd = useCallback(async () => {
    if (!newFrom) {
      toast.error(t("contracts.rates.error.validFrom"));
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(newRate) || Number(newRate) <= 0) {
      toast.error(t("contracts.rates.error.amount"));
      return;
    }
    if (newTo && newTo < newFrom) {
      toast.error(t("contracts.rates.error.validTo"));
      return;
    }
    const result = await execCreate({
      contractId,
      validFrom: newFrom,
      validTo: newTo || null,
      rate: newRate,
      note: newNote.trim() || null,
    });
    const error = errorText(result as ActionResult);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("contracts.rates.added"));
    setNewFrom(todayIso());
    setNewTo("");
    setNewRate("");
    setNewNote("");
    setAdding(false);
    await reload();
  }, [contractId, errorText, execCreate, newFrom, newNote, newRate, newTo, reload, t]);

  const handleEdit = useCallback(
    async (id: string, field: "validFrom" | "validTo" | "rate" | "note", value: string) => {
      const row = rates.find((r) => r.id === id);
      if (!row) return;
      const current = row[field] ?? "";
      if (value === current) return;
      if (field === "rate" && (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0)) {
        toast.error(t("contracts.rates.error.amount"));
        return;
      }
      if (field === "validFrom" && !value) {
        toast.error(t("contracts.rates.error.validFrom"));
        return;
      }
      const payload =
        field === "validTo" || field === "note" ? { [field]: value || null } : { [field]: value };
      const result = await execUpdate({ id, ...payload });
      const error = errorText(result as ActionResult);
      if (error) {
        toast.error(error);
        await reload(); // put the row back to what the server has
        return;
      }
      toast.success(t("contracts.rates.updated"));
      await reload();
    },
    [errorText, execUpdate, rates, reload, t],
  );

  const handleDelete = useCallback(
    (row: ContractRateRow) => {
      confirm(
        async () => {
          const result = await execDelete({ id: row.id });
          const error = errorText(result as ActionResult);
          if (error) throw new Error(error);
          toast.success(t("contracts.rates.deleted"));
          await reload();
        },
        {
          description: t("contracts.rates.deleteConfirm.description", {
            rate: formatMoney(row.rate, currency),
            from: row.validFrom,
          }),
        },
      );
    },
    [confirm, currency, errorText, execDelete, reload, t],
  );

  const money = useMemo(() => (amount: string) => formatMoney(amount, currency), [currency]);

  return (
    <div data-testid="contract-rates">
      <DetailsSection title={t("contracts.rates.title")} className="space-y-2">
        {!adding && (
          <div className="mb-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              {t("contracts.rates.add")}
            </Button>
          </div>
        )}

        {adding && (
          <form
            className="mb-2 flex flex-wrap items-end gap-3 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <div>
              <label htmlFor={`${ids}-from`} className="mb-1 block text-xs font-medium">
                {t("contracts.rates.validFrom")}
              </label>
              <Input
                id={`${ids}-from`}
                type="date"
                value={newFrom}
                onChange={(e) => setNewFrom(e.target.value)}
                className="h-8"
                required
              />
            </div>
            <div>
              <label htmlFor={`${ids}-to`} className="mb-1 block text-xs font-medium">
                {t("contracts.rates.validTo")}
              </label>
              <Input
                id={`${ids}-to`}
                type="date"
                value={newTo}
                onChange={(e) => setNewTo(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="w-32">
              <label htmlFor={`${ids}-rate`} className="mb-1 block text-xs font-medium">
                {t("contracts.rates.rate")}{" "}
                {currency ? `(${currency}/${t("contracts.rates.unit.day")})` : ""}
              </label>
              <Input
                id={`${ids}-rate`}
                inputMode="decimal"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value.replace(",", "."))}
                placeholder="1200.00"
                className="h-8"
                autoFocus
              />
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
                {t("contracts.rates.note")}
              </label>
              <Input
                id={`${ids}-note`}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="h-8"
                maxLength={500}
              />
            </div>
            <Button type="submit" size="sm" disabled={isCreating || !newFrom || !newRate}>
              {t("common.add")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
            <p className="basis-full text-xs text-muted-foreground">{t("contracts.rates.tip")}</p>
          </form>
        )}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("contracts.rates.validFrom")}</TableHead>
                <TableHead className="w-40">{t("contracts.rates.validTo")}</TableHead>
                <TableHead className="w-40 text-right">{t("contracts.rates.rate")}</TableHead>
                <TableHead>{t("contracts.rates.note")}</TableHead>
                <TableHead className="w-28">{t("partners.col.status")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-12 text-center text-muted-foreground">
                    {t("contracts.rates.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                rates.map((row) => (
                  <RateRow
                    // remount when the server changed the row (auto-close, edit refused) so the inputs show the truth
                    key={`${row.id}:${row.validFrom}:${row.validTo ?? ""}:${row.rate}:${row.note ?? ""}`}
                    row={row}
                    money={money}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DetailsSection>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

function RateRow({
  row,
  money,
  onEdit,
  onDelete,
}: {
  row: ContractRateRow;
  money: (amount: string) => string;
  onEdit: (id: string, field: "validFrom" | "validTo" | "rate" | "note", value: string) => void;
  onDelete: (row: ContractRateRow) => void;
}) {
  const t = useT();
  const [from, setFrom] = useState(row.validFrom);
  const [to, setTo] = useState(row.validTo ?? "");
  const [rate, setRate] = useState(row.rate);
  const [note, setNote] = useState(row.note ?? "");
  const [editingRate, setEditingRate] = useState(false);

  return (
    <TableRow data-state={row.state}>
      <TableCell>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          onBlur={() => onEdit(row.id, "validFrom", from)}
          className="h-8"
          aria-label={t("contracts.rates.validFrom")}
        />
      </TableCell>
      <TableCell>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onBlur={() => onEdit(row.id, "validTo", to)}
          className="h-8"
          placeholder={t("contracts.rates.open")}
          aria-label={t("contracts.rates.validTo")}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {editingRate ? (
          <Input
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(",", "."))}
            onBlur={() => {
              setEditingRate(false);
              onEdit(row.id, "rate", rate);
            }}
            className="h-8 text-right"
            aria-label={t("contracts.rates.rate")}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-right hover:bg-hover"
            onClick={() => setEditingRate(true)}
            title={t("common.edit")}
            data-amount={row.rate}
          >
            {money(row.rate)}
          </button>
        )}
      </TableCell>
      <TableCell>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onEdit(row.id, "note", note)}
          className="h-8"
          maxLength={500}
          aria-label={t("contracts.rates.note")}
        />
      </TableCell>
      <TableCell>
        <StateLabel
          family={rateStateFamily(row.state)}
          state={t(`contracts.rates.state.${row.state}`)}
        />
      </TableCell>
      <TableCell className="text-right">
        <RowActionsMenu
          label={t("table.rowActions")}
          actions={[{ label: t("common.delete"), destructive: true, onClick: () => onDelete(row) }]}
        />
      </TableCell>
    </TableRow>
  );
}
