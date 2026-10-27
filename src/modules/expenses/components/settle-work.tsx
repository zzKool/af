"use client";

// The settle page (US4, US5, F114): open private expenses left (FIFO order, ticks, editable base allocations, a
// *full* tick when the owner accepted less base than the claim — a cross-currency refund), the refund transaction
// right (picker with the coverage hint), the summary with the derived difference, the confirm dialog. The arithmetic
// is the server's (`settlement-math.ts`, the one tolerance), in Decimal — never Number. Σ base never exceeds the row.
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
import { formatMoney } from "@/kernel/money/format-money";
import { WorkPage } from "@/kernel/ui/shell/page";
import { StateIcon } from "@/kernel/ui/state-label";
import { CodeChip } from "@/kernel/ui/tags";
import {
  confirmSettlementAction,
  proposeSettlementAction,
} from "@/modules/expenses/expenses.actions";
import type { OpenExpense } from "@/modules/expenses/fifo";
import {
  amountForBase,
  expectedBaseFor,
  settlementTotals,
} from "@/modules/expenses/settlement-math";
import type { SourceOption, TransactionOption } from "@/modules/expenses/types";

export type OpenRow = OpenExpense & {
  paidFromAccountId: string;
  currency: string;
  amount: string;
  openAmount: string;
};

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

const NONE = "__none__";
const money = (amount: string, currency: string) => formatMoney(amount, currency);
/** an SEK figure inside a sentence whose template already says "SEK" */
const sek = (amount: string) => formatMoney(amount, "SEK", { bare: true });
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
    [...new Set(open.map((e) => e.paidFromAccountId))].length === 1
      ? open[0]?.paidFromAccountId
      : NONE,
  );
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** the owner's word that a line is refunded in full although the base falls short of the claim (the difference shows) */
  const [full, setFull] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);
  const { executeAsync: propose, isPending: proposing } = useAction(proposeSettlementAction);
  const { executeAsync: confirm, isPending: confirming } = useAction(confirmSettlementAction);

  const tx = transactions.find((x) => x.id === txId) ?? null;
  const rows = useMemo(
    () => open.filter((e) => sourceId === NONE || e.paidFromAccountId === sourceId),
    [open, sourceId],
  );
  const selected = rows.filter((e) => ticked.has(e.expenseId));
  const allocationOf = (e: OpenRow) => dec(alloc[e.expenseId] ?? e.openBase);
  /** what the line refunds of the expense: the share the base covers, or the whole open amount on the owner's word */
  const amountOf = (e: OpenRow) =>
    full[e.expenseId] ? new D(e.openAmount) : amountForBase(e, allocationOf(e));
  const partialByBase = (e: OpenRow) => amountForBase(e, allocationOf(e)).lt(new D(e.openAmount));
  const lines = selected.map((e) => ({
    allocatedBase: fix(allocationOf(e)),
    expectedBase: fix(expectedBaseFor(e, amountOf(e), allocationOf(e))),
  }));
  const refundBase = tx?.amountBase ? new D(tx.amountBase).abs() : null;
  // the server's own arithmetic (settlement-math.ts), in Decimal — the same one propose and confirm run (F62)
  const totals = settlementTotals(lines, refundBase ?? "0");
  const allocated = totals.allocatedBase;
  const over = refundBase !== null && allocated.gt(refundBase);
  const rounding = refundBase !== null && totals.rounding;
  const difference = refundBase !== null && !totals.rounding ? totals.differenceBase : new D(0);
  const unallocated = refundBase === null ? new D(0) : totals.unallocatedBase;
  // what stays owed on the ledger after these lines: the claim the lines do not reach, in base
  const residual = selected.reduce<Dec>(
    (acc, e) =>
      acc.plus(D.max(new D(e.openBase).minus(expectedBaseFor(e, amountOf(e), allocationOf(e))), 0)),
    new D(0),
  );

  // a new refund row resets the ticks to a FIFO proposal
  useEffect(() => {
    if (txId === NONE || tick < 0) return;
    let cancelled = false;
    (async () => {
      const r = await propose({
        bankTransactionId: txId,
        paidFromAccountId: sourceId === NONE ? undefined : sourceId,
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
      if (p.paidFromAccountId && sourceId === NONE) setSourceId(p.paidFromAccountId);
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
      lines: selected.map((e) => ({
        expenseId: e.expenseId,
        allocatedBase: fix(allocationOf(e)),
        ...(full[e.expenseId] ? { allocatedAmount: e.openAmount } : {}),
      })),
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

  const canConfirm = !!tx && sourceId !== NONE && selected.length > 0 && allocated.gt(0) && !over;

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
                    <CodeChip>{e.key}</CodeChip>
                    <span className="text-xs text-muted-foreground tabular-nums">{e.date}</span>
                  </div>
                  <div className="truncate text-xs" title={e.description}>
                    {e.description} · {money(e.amount, e.currency)} · {t("expenses.col.open")}{" "}
                    {sek(e.openBase)}
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
                {on && partialByBase(e) && (
                  <label
                    className="flex items-center gap-1 text-xs"
                    title={t("expenses.settle.fullHint")}
                  >
                    <Checkbox
                      checked={!!full[e.expenseId]}
                      onCheckedChange={(c) => setFull((f) => ({ ...f, [e.expenseId]: c === true }))}
                      aria-label={`${t("expenses.settle.full")} ${e.key}`}
                      data-testid="settle-full"
                    />
                    {t("expenses.settle.full")}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-right text-sm tabular-nums" data-testid="settle-selected">
        {t("expenses.settle.selected", { amount: sek(fix(allocated)) })}
      </p>
    </div>
  );

  const hint = !tx
    ? null
    : refundBase === null
      ? null
      : over
        ? t("expenses.settle.short", { amount: sek(fix(allocated.minus(refundBase))) })
        : unallocated.gt(0)
          ? t("expenses.settle.covers", { amount: sek(fix(unallocated)) })
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
                ? ` = ${formatMoney(tx.amountBase, "SEK")}`
                : ""}
            </span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>
              {t("expenses.settle.available", {
                amount: refundBase === null ? "—" : sek(fix(refundBase)),
              })}
            </span>
            <span data-testid="settle-hint">{hint}</span>
          </div>
          {rounding && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("expenses.settle.rounding", { amount: sek(fix(totals.differenceBase)) })}
            </p>
          )}
          {!difference.isZero() && (
            <p className="mt-1 flex items-center gap-1.5 text-xs" data-testid="settle-difference">
              <StateIcon family="attention" />
              {t("expenses.settle.exchangeDifference", {
                amount: sek(fix(difference)),
                code: difference.gt(0) ? "7960" : "3960",
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
              onClick={() => setConfirmOpen(true)}
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
              {!difference.isZero()
                ? t("expenses.settle.confirmOver", {
                    amount: sek(fix(difference)),
                    code: difference.gt(0) ? "7960" : "3960",
                  })
                : residual.gt(0)
                  ? t("expenses.settle.confirmPartial", {
                      amount: sek(fix(residual)),
                    })
                  : t("expenses.settle.confirmExact")}
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-md border text-sm">
            {selected.map((e) => (
              <li key={e.expenseId} className="flex items-center justify-between px-3 py-1.5">
                <CodeChip>{e.key}</CodeChip>
                <span className="tabular-nums">{formatMoney(fix(allocationOf(e)), "SEK")}</span>
              </li>
            ))}
            <li className="flex items-center justify-between px-3 py-1.5 font-medium">
              <span>{t("expenses.statement.total")}</span>
              <span className="tabular-nums">{formatMoney(fix(allocated), "SEK")}</span>
            </li>
          </ul>
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
        open: sek(ledgerOpen),
        count: ledgerCount,
      })}
      left={left}
      right={right}
      leftWidth="30rem"
    />
  );
}
