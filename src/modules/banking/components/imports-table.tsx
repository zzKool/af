"use client";

// The import history: one row per file, with its counts and period; delete (refused while linked).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
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
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { deleteImportAction } from "@/modules/banking/banking.actions";
import type { BankImportDto } from "@/modules/banking/types";
import { type AccountOption, ImportDialog } from "./import-dialog";

export type ImportRow = Omit<BankImportDto, "importedAt"> & {
  importedAt: string;
  accountLabel: string;
};

export function ImportsTable({
  imports,
  accounts,
  canWrite,
}: {
  imports: ImportRow[];
  accounts: AccountOption[];
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ImportRow | null>(null);
  const { executeAsync: remove, isPending } = useAction(deleteImportAction);

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await remove({ id: toDelete.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.imports.deleted"));
    setToDelete(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && (
        <div>
          <Button size="sm" onClick={() => setImportOpen(true)} data-testid="open-import">
            {t("banking.import.button")}
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("banking.imports.col.file")}</TableHead>
              <TableHead>{t("banking.imports.col.account")}</TableHead>
              <TableHead>{t("banking.imports.col.period")}</TableHead>
              <TableHead className="text-right">{t("banking.imports.col.rows")}</TableHead>
              <TableHead className="text-right">{t("banking.imports.col.imported")}</TableHead>
              <TableHead className="text-right">{t("banking.imports.col.duplicates")}</TableHead>
              <TableHead className="text-right">{t("banking.imports.col.errors")}</TableHead>
              <TableHead>{t("banking.imports.col.date")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {t("banking.imports.empty")}
                </TableCell>
              </TableRow>
            )}
            {imports.map((i) => (
              <TableRow key={i.id} data-testid="import-row">
                <TableCell className="max-w-[20rem] truncate" title={i.fileName}>
                  <Link href={`/banking?f.bankImportId=in:${i.id}`} className="hover:underline">
                    {i.fileName}
                  </Link>
                </TableCell>
                <TableCell>{i.accountLabel}</TableCell>
                <TableCell className="tabular-nums">
                  {i.periodFrom && i.periodTo ? `${i.periodFrom} → ${i.periodTo}` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.recordCount}</TableCell>
                <TableCell className="text-right tabular-nums">{i.importedCount}</TableCell>
                <TableCell className="text-right tabular-nums">{i.duplicateCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {i.errorCount > 0 ? (
                    <span className="text-red-700" title={i.errors.join("\n")}>
                      {i.errorCount}
                    </span>
                  ) : (
                    0
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {i.importedAt.slice(0, 16).replace("T", " ")}
                </TableCell>
                <TableCell className="text-right">
                  {canWrite && (
                    <Button size="sm" variant="ghost" onClick={() => setToDelete(i)}>
                      {t("banking.imports.delete")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {canWrite && (
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} accounts={accounts} />
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        description={t("banking.imports.deleteConfirm", { count: toDelete?.importedCount ?? 0 })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmDelete()}
        isLoading={isPending}
      />
    </div>
  );
}
