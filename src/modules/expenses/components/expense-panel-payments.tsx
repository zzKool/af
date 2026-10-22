"use client";

// The payment side of the expense panel: attach / detach the bank row of a company-paid expense (rows of the
// payer's account), and the owner settlements the expense took part in.
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import {
  attachBankTransactionAction,
  detachBankTransactionAction,
} from "@/modules/expenses/expenses.actions";
import type { SourceOption, TransactionOption } from "@/modules/expenses/types";
import { type ExpensePanelDetail, money, NONE } from "./expense-panel-shared";

export function ExpenseAttachRow({
  detail,
  sources,
  transactions,
  canWrite,
  onChanged,
}: {
  detail: ExpensePanelDetail;
  sources: SourceOption[];
  /** outgoing rows not settling anything — filtered here on the payer's account */
  transactions: TransactionOption[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const ids = useId();
  const [attachId, setAttachId] = useState(NONE);
  const { executeAsync: attach, isPending: attaching } = useAction(attachBankTransactionAction);
  const { executeAsync: detach, isPending: detaching } = useAction(detachBankTransactionAction);

  const e = detail.expense;
  const companyPaid = detail.paymentSource.kind === "bank_account";
  const attachable = transactions.filter(
    (tx) =>
      tx.bankAccountId === sources.find((s) => s.id === detail.paymentSource.id)?.bankAccountId,
  );

  async function attachRow() {
    if (attachId === NONE) return;
    const r = await attach({ expenseId: e.id, bankTransactionId: attachId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("expenses.panel.attached"));
    setAttachId(NONE);
    onChanged();
  }

  async function detachRow() {
    const r = await detach({ expenseId: e.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("expenses.panel.detached"));
    onChanged();
  }

  if (!canWrite || !companyPaid) return null;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2" data-testid="attach-row">
      {e.paidAmount ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void detachRow()}
          disabled={detaching}
          data-testid="detach-bank-row"
        >
          {t("expenses.panel.detach")}
        </Button>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${ids}-attach`} className="mb-1 block text-xs font-medium">
              {t("expenses.panel.attachPick")}
            </label>
            <Select value={attachId} onValueChange={(v) => setAttachId(v ?? NONE)}>
              <SelectTrigger id={`${ids}-attach`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {attachable.map((tx) => (
                  <SelectItem key={tx.id} value={tx.id}>
                    {tx.bookingDate} · {money(tx.amount, tx.currency)} · {tx.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={() => void attachRow()}
            disabled={attaching || attachId === NONE}
            data-testid="attach-bank-row"
          >
            {t("expenses.panel.attach")}
          </Button>
        </>
      )}
    </div>
  );
}

export function ExpenseSettlementsSection({ detail }: { detail: ExpensePanelDetail }) {
  const t = useT();
  if (detail.settlements.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t("expenses.panel.settlements")}</h3>
      <ul className="divide-y rounded-md border text-sm">
        {detail.settlements.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span>
              <Link href={`/expenses/settlements`} className="font-mono text-xs hover:underline">
                {s.number}
              </Link>
              {s.bookingDate ? ` · ${s.bookingDate}` : ""}
              {s.status === "cancelled" ? ` · ${t("expenses.settlements.status.cancelled")}` : ""}
            </span>
            <span className="tabular-nums">{formatCurrency(s.allocatedBase, "SEK")} SEK</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
