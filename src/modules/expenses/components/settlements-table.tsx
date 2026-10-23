"use client";

// Settlements (D40): the number a code chip linking to its statement page, money through formatMoney, the state a
// <StateLabel>, the statement (download once the job stored it); Open · Download · Cancel in the ⋮ row menu.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Prisma } from "@/generated/prisma/browser";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { RowActionsMenu } from "@/kernel/ui/data-table";
import { CodeChip } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { getDocumentDownloadUrlAction } from "@/modules/documents/ui";
import { cancelSettlementAction, listSettlementsAction } from "@/modules/expenses/expenses.actions";
import type { SettlementListRow } from "@/modules/expenses/queries";
import { SettlementStateLabel } from "./expense-state";

export type SettlementRow = Omit<SettlementListRow, "createdAt" | "updatedAt" | "cancelledAt"> & {
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

/** exchange difference + rounding, to the öre — Decimal, never Number (display boundary only) */
export function settlementDifferenceBase(
  s: Pick<SettlementRow, "exchangeDifferenceBase" | "roundingBase">,
): string {
  return new Prisma.Decimal(s.exchangeDifferenceBase).plus(s.roundingBase).toFixed(2);
}

export function SettlementsTable({ rows, canWrite }: { rows: SettlementRow[]; canWrite: boolean }) {
  const t = useT();
  const router = useRouter();
  const { executeAsync: cancel } = useAction(cancelSettlementAction);
  const { executeAsync: downloadUrl } = useAction(getDocumentDownloadUrlAction);
  const cancelDialog = useConfirmDialog({
    title: t("expenses.settlements.cancel"),
    variant: "destructive",
    confirmLabel: t("expenses.settlements.cancel"),
  });

  // the statement arrives a second or two after confirm — re-read the list until every active row has it
  // (bounded; a server action rather than router.refresh, whose result the client router may serve from cache)
  const [live, setLive] = useState(rows);
  const [seen, setSeen] = useState(rows);
  if (seen !== rows) {
    setSeen(rows);
    setLive(rows);
  }
  const { executeAsync: reload } = useAction(listSettlementsAction);
  const pending = live.some((r) => r.status === "active" && !r.statementDocumentId);
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (!pending || polls > 30) return;
    const h = setTimeout(async () => {
      setPolls((n) => n + 1);
      const r = await reload({});
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (d) {
        setLive(
          d.map((s) => ({
            ...s,
            createdAt: String(s.createdAt),
            updatedAt: String(s.updatedAt),
            cancelledAt: s.cancelledAt ? String(s.cancelledAt) : null,
          })),
        );
      }
    }, 2000);
    return () => clearTimeout(h);
  }, [pending, polls, reload]);

  async function download(documentId: string) {
    const r = await downloadUrl({ documentId });
    const error = extractError(r);
    if (error) return toast.error(error);
    const url = r?.data?.data?.downloadUrl;
    if (url) window.open(url, "_blank", "noopener");
  }

  function confirmCancel(s: SettlementRow) {
    cancelDialog.confirm(
      async () => {
        const r = await cancel({ id: s.id });
        const error = extractError(r);
        if (error) throw new Error(error);
        toast.success(t("expenses.settlements.cancelled", { number: s.number }));
        router.refresh();
      },
      { description: t("expenses.settlements.cancelConfirm", { number: s.number }) },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {live.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("expenses.settlements.empty")}</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("expenses.settlements.col.number")}</TableHead>
                <TableHead className="w-28">{t("expenses.settlements.col.date")}</TableHead>
                <TableHead>{t("expenses.settle.source")}</TableHead>
                <TableHead className="w-32 text-right">
                  {t("expenses.settlements.col.refund")}
                </TableHead>
                <TableHead className="w-28 text-right">
                  {t("expenses.settlements.col.base")}
                </TableHead>
                <TableHead className="w-28 text-right">
                  {t("expenses.settlements.col.allocated")}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t("expenses.settlements.col.difference")}
                </TableHead>
                <TableHead className="w-16 text-right">
                  {t("expenses.settlements.col.lines")}
                </TableHead>
                <TableHead className="w-24">{t("expenses.settlements.col.status")}</TableHead>
                <TableHead className="w-44">{t("expenses.settlements.col.statement")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {live.map((s) => {
                const diff = settlementDifferenceBase(s);
                return (
                  <TableRow key={s.id} data-testid="settlement-row">
                    <TableCell>
                      <Link href={`/expenses/settlements/${s.id}`} data-testid="settlement-link">
                        <CodeChip>{s.number}</CodeChip>
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{s.bookingDate ?? "—"}</TableCell>
                    <TableCell>{s.paymentSourceLabel}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(s.refundAmount, s.refundCurrency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(s.refundBase, "SEK", { bare: true })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(s.allocatedBase, "SEK", { bare: true })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(diff) === 0 ? "—" : formatMoney(diff, "SEK", { bare: true })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.lineCount}</TableCell>
                    <TableCell>
                      <SettlementStateLabel status={s.status} testId="settlement-status" />
                    </TableCell>
                    <TableCell>
                      {s.statementDocumentId ? (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto px-0 font-mono text-xs"
                          onClick={() => void download(s.statementDocumentId as string)}
                          data-testid="download-statement"
                        >
                          Reimb_{s.number}
                          {s.statementSuperseded
                            ? ` · ${t("expenses.settlements.superseded")}`
                            : ""}
                        </Button>
                      ) : s.status === "active" ? (
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid="statement-pending"
                        >
                          {t("expenses.settlements.pending")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActionsMenu
                        label={t("table.rowActions")}
                        actions={[
                          {
                            label: t("common.open"),
                            onClick: () => router.push(`/expenses/settlements/${s.id}`),
                          },
                          ...(s.statementDocumentId
                            ? [
                                {
                                  label: t("documents.download"),
                                  onClick: () => void download(s.statementDocumentId as string),
                                },
                              ]
                            : []),
                          ...(canWrite && s.status === "active"
                            ? [
                                {
                                  label: t("expenses.settlements.cancel"),
                                  destructive: true,
                                  onClick: () => confirmCancel(s),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog {...cancelDialog.dialogProps} />
    </div>
  );
}
