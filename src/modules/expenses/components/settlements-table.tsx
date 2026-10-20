"use client";

// Settlements: number, refund, settled, difference, status, the statement (download once the job stored it), cancel.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { getDocumentDownloadUrlAction } from "@/modules/documents/ui";
import { cancelSettlementAction, listSettlementsAction } from "@/modules/expenses/expenses.actions";
import type { SettlementListRow } from "@/modules/expenses/queries";

export type SettlementRow = Omit<SettlementListRow, "createdAt" | "updatedAt" | "cancelledAt"> & {
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/expenses" />}>
          {t("expenses.title")}
        </Button>
        {canWrite && (
          <Button size="sm" nativeButton={false} render={<Link href="/expenses/settle" />}>
            {t("expenses.nav.settle")}
          </Button>
        )}
      </div>
      {live.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("expenses.settlements.empty")}</p>
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
                {canWrite && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {live.map((s) => {
                const diff = Number(s.exchangeDifferenceBase) + Number(s.roundingBase);
                return (
                  <TableRow key={s.id} data-testid="settlement-row">
                    <TableCell className="font-mono text-xs">{s.number}</TableCell>
                    <TableCell className="tabular-nums">{s.bookingDate ?? "—"}</TableCell>
                    <TableCell>{s.paymentSourceLabel}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(s.refundAmount, s.refundCurrency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(s.refundBase, "SEK")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(s.allocatedBase, "SEK")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {diff === 0 ? "—" : diff.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.lineCount}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          s.status === "active"
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : "bg-muted text-muted-foreground"
                        }
                        data-testid="settlement-status"
                      >
                        {t(`expenses.settlements.status.${s.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.statementDocumentId ? (
                        <Button
                          size="sm"
                          variant="outline"
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
                      <Link
                        href={`/expenses/settlements/${s.id}`}
                        className="ml-2 text-xs hover:underline"
                      >
                        →
                      </Link>
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        {s.status === "active" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid="cancel-settlement"
                            onClick={() =>
                              cancelDialog.confirm(
                                async () => {
                                  const r = await cancel({ id: s.id });
                                  const error = extractError(r);
                                  if (error) throw new Error(error);
                                  toast.success(
                                    t("expenses.settlements.cancelled", { number: s.number }),
                                  );
                                  router.refresh();
                                },
                                {
                                  description: t("expenses.settlements.cancelConfirm", {
                                    number: s.number,
                                  }),
                                },
                              )
                            }
                          >
                            {t("expenses.settlements.cancel")}
                          </Button>
                        )}
                      </TableCell>
                    )}
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
