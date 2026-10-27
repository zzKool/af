"use client";

// The payment side of the expense panel (F114, D60): the payments ARE the links — each one the bank row, what it
// pays in the expense's currency, the base it gave; the FX difference derived beside them. A company-paid expense
// takes another row from the payer's account (a deposit and a balance; the picker offers what has something left);
// *Remove* takes one link away. A private expense lists its settlements. The linking inbox sends the owner here
// for an expense's payment (D37, F58): `?open=<expense>&attach=<bank row>` preselects that row.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CodeChip } from "@/kernel/ui/tags";
import { payExpenseAction, unpayExpenseAction } from "@/modules/expenses/expenses.actions";
import type { SettlementStatus, SourceOption, TransactionOption } from "@/modules/expenses/types";
import { PaymentPicker } from "@/modules/linking/ui";
import { type ExpensePanelDetail, NONE } from "./expense-panel-shared";
import { SettlementStateLabel } from "./expense-state";

const BASE = "SEK";

/** The payments listed: one line per link — the row, what it pays, the base it gave — and the difference. */
export function ExpensePaymentsList({
  detail,
  canWrite,
  onChanged,
}: {
  detail: ExpensePanelDetail;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const e = detail.expense;
  const { executeAsync: unpay, isPending } = useAction(unpayExpenseAction);
  const payments = detail.payments.filter((p) => p.kind === "justifies");
  if (payments.length === 0) return null;

  async function remove(linkId: string) {
    const r = await unpay({ expenseId: e.id, linkId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("expenses.panel.paymentRemoved"));
    onChanged();
  }

  const difference = Number(detail.fxDifference);
  return (
    <div data-testid="payments">
      <div className="mb-1 text-xs text-muted-foreground">{t("expenses.panel.payments")}</div>
      <ul className="divide-y divide-subtle rounded-md border text-[13px]">
        {payments.map((p) => (
          <li
            key={p.linkId}
            className="flex items-center justify-between gap-2 px-2.5 py-1.5"
            data-testid="payment"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <Link
                href={`/banking?open=${p.bankTransactionId}`}
                className="tabular-nums hover:underline"
              >
                {p.bookingDate ?? p.rowLabel ?? "—"}
              </Link>
              <span className="tabular-nums">{formatMoney(p.allocatedAmount, p.currency)}</span>
              <span className="text-muted-foreground tabular-nums">
                {t("expenses.panel.paymentBase", { base: formatMoney(p.allocatedBase, BASE) })}
              </span>
            </span>
            {canWrite && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(p.linkId)}
                disabled={isPending}
                data-testid="remove-payment"
              >
                {t("expenses.panel.removePayment")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {difference !== 0 && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums" data-testid="fx-difference">
          {t("expenses.panel.fxDifference", {
            amount: formatMoney(detail.fxDifference, BASE),
            code: difference > 0 ? "7960" : "3960",
          })}
        </p>
      )}
    </div>
  );
}

/** Pay a company-paid expense from a bank row of the payer's account — while something is still open on it. */
export function ExpensePayRow({
  detail,
  transactions,
  canWrite,
  onChanged,
}: {
  detail: ExpensePanelDetail;
  /** unused since F114 — the payer IS a bank account; kept so the panel's prop shape does not move */
  sources?: SourceOption[];
  /** outgoing rows with something left — filtered here on the payer's account */
  transactions: TransactionOption[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const params = useSearchParams();
  const e = detail.expense;
  const companyPaid = detail.payer.kind === "bank_account";
  const payable = transactions.filter((tx) => tx.bankAccountId === detail.payer.id);
  const [rowId, setRowId] = useState(() => {
    const wanted = params.get("open") === e.id ? params.get("attach") : null;
    return wanted && payable.some((tx) => tx.id === wanted) ? wanted : NONE;
  });
  const { executeAsync: pay, isPending } = useAction(payExpenseAction);

  async function payRow() {
    if (rowId === NONE) return;
    const r = await pay({ expenseId: e.id, bankTransactionId: rowId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("expenses.panel.attached"));
    setRowId(NONE);
    onChanged();
  }

  if (!canWrite || !companyPaid || Number(detail.open) <= 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="attach-row">
      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-medium">{t("expenses.panel.attachPick")}</span>
        <PaymentPicker
          entity={{ type: "expense", id: e.id }}
          rows={payable}
          value={rowId === NONE ? null : rowId}
          onChange={(id) => setRowId(id ?? NONE)}
        />
      </div>
      <Button
        size="sm"
        onClick={() => void payRow()}
        disabled={isPending || rowId === NONE}
        data-testid="attach-bank-row"
      >
        {t("expenses.panel.attach")}
      </Button>
    </div>
  );
}

/** The owner settlements the expense took part in (Proof): the number, the state, the base allocated. */
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
            <span className="shrink-0 tabular-nums">{formatMoney(s.allocatedBase, BASE)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
