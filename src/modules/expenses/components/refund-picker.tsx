"use client";

// *This row refunds me* inside the work surface (review 2026-10-31 §5.1, T021): the FIFO over the open private
// expenses proposed for the row the owner is on — ticks and the base each line takes, editable — and *Confirm*
// writing the settlement, its `settles` links and the statement exactly as the settle page does
// (`confirmSettlementAction`, the server's checks). The row is the panel's, never picked here. What the compact
// picker leaves out — the instrument filter, the *in full* tick of a cross-currency refund, the note — stays on the
// settle page, one link away (`/expenses/settle?row=`). Amounts in the base are shown bare: the row and the claims
// are compared in the tenant's base, whose code the templates name.
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Prisma } from "@/generated/prisma/browser";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CodeChip } from "@/kernel/ui/tags";
import {
  confirmSettlementAction,
  openPrivateExpensesAction,
  proposeSettlementAction,
} from "@/modules/expenses/expenses.actions";
import type { OpenPrivateExpense } from "@/modules/expenses/settlements";
import type { SettlementProposal } from "@/modules/expenses/types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** a typed allocation as a Decimal (0 while the field is not a number yet), to the cent */
function dec(v: string): Dec {
  try {
    return new D(v.trim() === "" ? "0" : v.trim()).toDecimalPlaces(2, D.ROUND_HALF_UP);
  } catch {
    return new D(0);
  }
}
const bare = (amount: string) => formatMoney(amount, null);

export function RefundPicker({
  transactionId,
  onDone,
  onCancel,
}: {
  /** the refund row the panel is on — company → owner, outgoing, on a main account */
  transactionId: string;
  /** the settlement is written: the host reloads the row (now justified — the statement is its proof) */
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<OpenPrivateExpense[] | null>(null);
  const [proposal, setProposal] = useState<SettlementProposal | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const { executeAsync: loadOpen } = useAction(openPrivateExpensesAction);
  const { executeAsync: propose } = useAction(proposeSettlementAction);
  const { executeAsync: confirm, isPending: confirming } = useAction(confirmSettlementAction);

  // the open claims and the FIFO for this row — the ticks start from the proposal
  useEffect(() => {
    let live = true;
    void Promise.all([loadOpen({}), propose({ bankTransactionId: transactionId })]).then(
      ([o, p]) => {
        if (!live) return;
        const error = extractError(p) ?? extractError(o);
        if (error) {
          setLoadError(error);
          return;
        }
        const list = o?.data && "data" in o.data ? o.data.data : [];
        const prop = (p?.data && "data" in p.data ? p.data.data : null) ?? null;
        setOpen(list);
        setProposal(prop);
        if (prop) {
          setTicked(new Set(prop.lines.map((l) => l.expenseId)));
          setAlloc(Object.fromEntries(prop.lines.map((l) => [l.expenseId, l.allocatedBase])));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [transactionId, loadOpen, propose]);

  const rows = open ?? [];
  const selected = rows.filter((e) => ticked.has(e.expenseId));
  const allocationOf = (e: OpenPrivateExpense) => dec(alloc[e.expenseId] ?? e.openBase);
  const allocated = selected.reduce<Dec>((acc, e) => acc.plus(allocationOf(e)), new D(0));
  const refundBase = proposal ? new D(proposal.refundBase) : null;
  const over = refundBase !== null && allocated.gt(refundBase);
  const lineTooBig = selected.some((e) => allocationOf(e).gt(new D(e.openBase)));
  const canConfirm =
    !!proposal && selected.length > 0 && allocated.gt(0) && !over && !lineTooBig && !confirming;
  const hint =
    refundBase === null
      ? null
      : over
        ? t("expenses.settle.short", { amount: bare(allocated.minus(refundBase).toFixed(2)) })
        : refundBase.minus(allocated).gt(0)
          ? t("expenses.settle.covers", { amount: bare(refundBase.minus(allocated).toFixed(2)) })
          : t("expenses.settle.exact");

  function toggle(e: OpenPrivateExpense, on: boolean) {
    const next = new Set(ticked);
    if (on) {
      next.add(e.expenseId);
      if (!alloc[e.expenseId]) setAlloc((a) => ({ ...a, [e.expenseId]: e.openBase }));
    } else next.delete(e.expenseId);
    setTicked(next);
  }

  async function submit() {
    if (!canConfirm) return;
    const r = await confirm({
      bankTransactionId: transactionId,
      lines: selected.map((e) => ({
        expenseId: e.expenseId,
        allocatedBase: allocationOf(e).toFixed(2),
      })),
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const number = r?.data && "data" in r.data ? (r.data.data?.number ?? "") : "";
    toast.success(t("expenses.settle.confirmed", { number }));
    onDone();
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm"
      data-testid="refund-picker"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">{t("expenses.refund.title")}</div>
        <Link
          href={`/expenses/settle?row=${transactionId}`}
          className="text-xs text-primary underline-offset-2 hover:underline"
          data-testid="refund-open-settle"
        >
          {t("expenses.refund.openSettle")}
        </Link>
      </div>
      {loadError ? (
        <p className="text-xs text-destructive" data-testid="refund-error">
          {loadError}
        </p>
      ) : open === null ? (
        <p className="text-xs text-muted-foreground">{t("expenses.refund.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("expenses.settle.noOpen")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("expenses.refund.hint")}</p>
          <ul className="divide-y">
            {rows.map((e) => {
              const on = ticked.has(e.expenseId);
              return (
                <li
                  key={e.expenseId}
                  className="flex items-center gap-2 py-1.5"
                  data-testid="refund-line"
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
                      {e.description} · {formatMoney(e.amount, e.currency)} ·{" "}
                      {t("expenses.col.open")} {bare(e.openBase)}
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
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
            <span data-testid="refund-selected">
              {t("expenses.settle.selected", { amount: bare(allocated.toFixed(2)) })}
              {refundBase !== null &&
                ` · ${t("expenses.settle.available", { amount: bare(refundBase.toFixed(2)) })}`}
            </span>
            <span className="text-muted-foreground" data-testid="refund-hint">
              {lineTooBig ? t("expenses.refund.lineTooBig") : hint}
            </span>
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!canConfirm}
          onClick={() => void submit()}
          data-testid="refund-confirm"
        >
          {t("expenses.settle.confirm")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="refund-cancel">
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
