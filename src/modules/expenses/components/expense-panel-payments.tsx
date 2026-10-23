"use client";

// The payment side of the expense panel: attach / detach the bank row of a company-paid expense (rows of the
// payer's account), and the owner settlements the expense took part in. The linking inbox sends the owner here for
// an expense's payment (D37, F58): `?open=<expense>&attach=<bank row>` preselects that row.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { formatMoney } from "@/kernel/money/format-money";
import { CodeChip } from "@/kernel/ui/tags";
import {
  attachBankTransactionAction,
  detachBankTransactionAction,
} from "@/modules/expenses/expenses.actions";
import type { SettlementStatus, SourceOption, TransactionOption } from "@/modules/expenses/types";
import { type ExpensePanelDetail, money, NONE } from "./expense-panel-shared";
import { SettlementStateLabel } from "./expense-state";

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
  const params = useSearchParams();
  const e = detail.expense;
  const companyPaid = detail.paymentSource.kind === "bank_account";
  const attachable = transactions.filter(
    (tx) =>
      tx.bankAccountId === sources.find((s) => s.id === detail.paymentSource.id)?.bankAccountId,
  );
  const [attachId, setAttachId] = useState(() => {
    const wanted = params.get("open") === e.id ? params.get("attach") : null;
    return wanted && attachable.some((tx) => tx.id === wanted) ? wanted : NONE;
  });
  const { executeAsync: attach, isPending: attaching } = useAction(attachBankTransactionAction);
  const { executeAsync: detach, isPending: detaching } = useAction(detachBankTransactionAction);

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
    <div className="flex flex-wrap items-end gap-2" data-testid="attach-row">
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

/** The owner settlements the expense took part in (Proof): the number, the state, the SEK allocated. */
export function ExpenseSettlementsList({ detail }: { detail: ExpensePanelDetail }) {
  const t = useT();
  if (detail.settlements.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{t("expenses.panel.settlements")}</div>
      <ul className="divide-y divide-subtle rounded-md border text-[13px]">
        {detail.settlements.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <Link href={`/expenses/settlements/${s.id}`} className="hover:underline">
                <CodeChip>{s.number}</CodeChip>
              </Link>
              {s.bookingDate && <span className="tabular-nums">{s.bookingDate}</span>}
              <SettlementStateLabel status={s.status as SettlementStatus} />
            </span>
            <span className="shrink-0 tabular-nums">{formatMoney(s.allocatedBase, "SEK")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
