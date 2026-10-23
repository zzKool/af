"use client";

// The settle page (US4, US5): open private expenses left (FIFO order, ticks, editable allocations), the refund
// transaction right (picker with the coverage hint), the summary, the confirm dialog with its three states. The
// difference and the tolerance are the server's (`settlementDifference`, `owedBase`), in Decimal — never Number.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Prisma } from "@/generated/prisma/browser";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { WorkPage } from "@/kernel/ui/shell/page";
import {
  confirmSettlementAction,
  proposeSettlementAction,
} from "@/modules/expenses/expenses.actions";
import { type OpenExpense, settlementDifference } from "@/modules/expenses/fifo";
import { owedBase } from "@/modules/expenses/status";
import type { SourceOption, TransactionOption } from "@/modules/expenses/types";

export type OpenRow = OpenExpense & { paymentSourceId: string; currency: string; amount: string };

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

const NONE = "__none__";
const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;
/** A typed allocation as a Decimal (0 while the field is not a number yet), to the cent. */
const dec = (v: string): Dec => {
  try {
    return new D(v.trim() === "" ? "0" : v.trim()).toDecimalPlaces(2, D.ROUND_HALF_UP);
  } catch {
    return new D(0);
  }
};
const fix = (d: Dec) => d.toFixed(2);

export function SettleWork({
  open,
  transactions,
  sources,
  ledgerOpen,
  ledgerCount,
}: {
  open: OpenRow[];
  transactions: TransactionOption[];
  sources: SourceOption[];
  ledgerOpen: string;
  ledgerCount: number;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [txId, setTxId] = useState(NONE);
  const [sourceId, setSourceId] = useState(
    [...new Set(open.map((e) => e.paymentSourceId))].length === 1 ? open[0]?.paymentSourceId : NONE,
  );
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmExchange, setConfirmExchange] = useState(false);
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);
  const { executeAsync: propose, isPending: proposing } = useAction(proposeSettlementAction);
  const { executeAsync: confirm, isPending: confirming } = useAction(confirmSettlementAction);

  const tx = transactions.find((x) => x.id === txId) ?? null;
  const rows = useMemo(
    () => open.filter((e) => sourceId === NONE || e.paymentSourceId === sourceId),
    [open, sourceId],
  );
  const selected = rows.filter((e) => ticked.has(e.expenseId));
  const allocationOf = (e: OpenRow) => dec(alloc[e.expenseId] ?? e.openBase);
  const lines = selected.map((e) => ({ allocatedBase: fix(allocationOf(e)) }));
  const refundBase = tx?.amountBase ? new D(tx.amountBase).abs() : null;
  // the server's own arithmetic (fifo.ts / status.ts), in Decimal — the same one propose and confirm run (F62)
  const difference = settlementDifference(lines, refundBase ?? "0");
  const allocated = new D(difference.allocatedBase);
  const over = refundBase !== null && new D(difference.exchangeDifferenceBase).gt(0);
  const rounding = refundBase !== null && new D(difference.roundingBase).gt(0);
  const unallocated = refundBase === null ? new D(0) : new D(difference.unallocatedOnTransaction);
  // what stays owed on the ledger after these lines: `owedBase` of each, the ledger's own rule
  const residual = selected.reduce<Dec>(
    (acc, e) => acc.plus(owedBase(e.openBase, allocationOf(e))),
    new D(0),
  );

  // a new refund row resets the ticks to a FIFO proposal
  useEffect(() => {
    if (txId === NONE || tick < 0) return;
    let cancelled = false;
    (async () => {
      const r = await propose({
        bankTransactionId: txId,
        paymentSourceId: sourceId === NONE ? undefined : sourceId,
      });
      if (cancelled) return;
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      const p = r?.data && "data" in r.data ? r.data.data : undefined;
      if (!p) return;
      setTicked(new Set(p.lines.map((l) => l.expenseId)));
      setAlloc(Object.fromEntries(p.lines.map((l) => [l.expenseId, l.allocatedBase])));
      if (p.paymentSourceId && sourceId === NONE) setSourceId(p.paymentSourceId);
    })();
    return () => {
      cancelled = true;
    };
  }, [txId, sourceId, propose, tick]);

  function toggle(e: OpenRow, on: boolean) {
    const next = new Set(ticked);
    if (on) {
      next.add(e.expenseId);
      if (!alloc[e.expenseId]) setAlloc((a) => ({ ...a, [e.expenseId]: e.openBase }));
    } else next.delete(e.expenseId);
    setTicked(next);
  }

  async function submit() {
    if (!tx || sourceId === NONE) return;
    const r = await confirm({
      bankTransactionId: tx.id,
      paymentSourceId: sourceId,
      lines: selected.map((e) => ({
        expenseId: e.expenseId,
        allocatedBase: fix(allocationOf(e)),
      })),
      confirmExchangeDifference: confirmExchange,
      note: note.trim() || null,
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("expenses.settle.confirmed", { number: r?.data?.data?.number ?? "" }));
    setConfirmOpen(false);
    setTicked(new Set());
    setAlloc({});
    setTxId(NONE);
    router.push("/expenses/settlements");
    router.refresh();
  }

  const canConfirm =
    !!tx &&
    sourceId !== NONE &&
    selected.length > 0 &&
    allocated.gt(0) &&
    (!over || confirmExchange);

  const left = (
    <div className="flex flex-col gap-2 p-3" data-testid="settle-open">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t("expenses.settle.open")}</h2>
        <Select value={sourceId} onValueChange={(v) => setSourceId(v ?? NONE)}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("expenses.settle.source")}>
            <SelectValue placeholder={t("expenses.settle.source")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("expenses.settle.source")}</SelectItem>
            {sources
              .filter((s) => s.kind === "private")
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("expenses.settle.noOpen")}</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((e) => {
            const on = ticked.has(e.expenseId);
            return (
              <li
                key={e.expenseId}
                className="flex items-center gap-2 py-1.5"
                data-testid="settle-row"
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(c) => toggle(e, c === true)}
                  aria-label={e.key}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{e.key}</span>
                    <span className="text-xs text-muted-foreground">{e.date}</span>
                  </div>
                  <div className="truncate text-xs" title={e.description}>
                    {e.description} · {money(e.amount, e.currency)} · {t("expenses.col.open")}{" "}
                    {formatCurrency(e.openBase, "SEK")}
                  </div>
                </div>
                <Input
                  className="h-8 w-28 text-right tabular-nums"
                  inputMode="decimal"
                  aria-label={`${t("expenses.settle.allocate")} ${e.key}`}
                  value={alloc[e.expenseId] ?? e.openBase}
                  disabled={!on}
                  onChange={(ev) => setAlloc((a) => ({ ...a, [e.expenseId]: ev.target.value }))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-right text-sm tabular-nums" data-testid="settle-selected">
        {t("expenses.settle.selected", { amount: formatCurrency(fix(allocated), "SEK") })}
      </p>
    </div>
  );

  const hint = !tx
    ? null
    : refundBase === null
      ? null
      : over
        ? t("expenses.settle.short", {
            amount: formatCurrency(difference.exchangeDifferenceBase, "SEK"),
          })
        : unallocated.gt(0)
          ? t("expenses.settle.covers", { amount: formatCurrency(fix(unallocated), "SEK") })
          : t("expenses.settle.exact");

  const right = (
    <div className="flex flex-col gap-3" data-testid="settle-transaction">
      <div>
        <label htmlFor={`${ids}-tx`} className="mb-1 block text-xs font-medium">
          {t("expenses.settle.pickTransaction")}
        </label>
        <Select value={txId} onValueChange={(v) => setTxId(v ?? NONE)}>
          <SelectTrigger id={`${ids}-tx`} className="w-full" data-testid="pick-transaction">
            <SelectValue placeholder={t("expenses.settle.transaction")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {transactions.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.bookingDate} · {money(x.amount, x.currency)} · {x.description} · {x.accountLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {transactions.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("expenses.settle.noTransactions")}
          </p>
        )}
      </div>
      {tx && (
        <div className="rounded-md border p-3 text-sm" data-testid="settle-summary">
          <div className="flex items-center justify-between">
            <span>{t("expenses.settle.transaction")}</span>
            <span className="tabular-nums">
              {money(tx.amount, tx.currency)}
              {tx.amountBase && tx.currency !== "SEK"
                ? ` = ${formatCurrency(tx.amountBase, "SEK")} SEK`
                : ""}
            </span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>
              {t("expenses.settle.available", {
                amount: refundBase === null ? "—" : formatCurrency(fix(refundBase), "SEK"),
              })}
            </span>
            <span data-testid="settle-hint">{hint}</span>
          </div>
          {rounding && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("expenses.settle.rounding", { amount: difference.roundingBase })}
            </p>
          )}
          {over && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {t("expenses.settle.exchangeDifference", {
                amount: difference.exchangeDifferenceBase,
              })}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={proposing}
              onClick={() => setTick((n) => n + 1)}
              data-testid="propose-fifo"
            >
              {t("expenses.settle.propose")}
            </Button>
            <Button
              size="sm"
              disabled={!tx || selected.length === 0 || allocated.lte(0)}
              onClick={() => {
                setConfirmExchange(false);
                setConfirmOpen(true);
              }}
              data-testid="open-confirm"
            >
              {t("expenses.settle.confirm")}
            </Button>
          </div>
        </div>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {t("expenses.settle.confirmTitle", {
                amount: tx ? money(tx.amount, tx.currency) : "",
              })}
            </DialogTitle>
            <DialogDescription data-testid="confirm-state">
              {over
                ? t("expenses.settle.confirmOver", { amount: difference.exchangeDifferenceBase })
                : residual.gt(0)
                  ? t("expenses.settle.confirmPartial", {
                      amount: formatCurrency(fix(residual), "SEK"),
                    })
                  : t("expenses.settle.confirmExact")}
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-md border text-sm">
            {selected.map((e) => (
              <li key={e.expenseId} className="flex items-center justify-between px-3 py-1.5">
                <span className="font-mono text-xs">{e.key}</span>
                <span className="tabular-nums">
                  {formatCurrency(fix(allocationOf(e)), "SEK")} SEK
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between px-3 py-1.5 font-medium">
              <span>{t("expenses.statement.total")}</span>
              <span className="tabular-nums">{formatCurrency(fix(allocated), "SEK")} SEK</span>
            </li>
          </ul>
          {over && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`${ids}-exchange`}
                checked={confirmExchange}
                onCheckedChange={(c) => setConfirmExchange(c === true)}
                data-testid="confirm-exchange"
                aria-label={t("expenses.settle.confirmExchange")}
              />
              <span>{t("expenses.settle.confirmExchange")}</span>
            </label>
          )}
          <div>
            <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
              {t("expenses.settle.note")}
            </label>
            <Input id={`${ids}-note`} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!canConfirm || confirming}
              data-testid="confirm-settlement"
            >
              {t("expenses.settle.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  return (
    <WorkPage
      title={t("expenses.settle.title")}
      meta={t("expenses.settle.meta", {
        open: formatCurrency(ledgerOpen, "SEK"),
        count: ledgerCount,
      })}
      left={left}
      right={right}
      leftWidth="30rem"
    />
  );
}
