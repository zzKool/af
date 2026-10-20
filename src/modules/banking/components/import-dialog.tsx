"use client";

import { useRouter } from "next/navigation";
// Import a Nordea export: pick the file → the account is pre-selected from the file name (and the first row's
// currency) → import → the summary, with a link to the new rows.
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { detectAccountAction, importCsvAction } from "@/modules/banking/banking.actions";
import type { ImportSummary } from "@/modules/banking/types";

export type AccountOption = { id: string; label: string; currency: string };

const NONE = "__none__";

/** the Currency column of the first data row, read in the browser to tell the SEK and CHF accounts apart */
async function firstRowCurrency(file: File): Promise<string | null> {
  const text = await file.slice(0, 4096).text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.split(";") ?? [];
  const idx = header.findIndex((h) => h.trim().toLowerCase() === "currency");
  const cell = idx >= 0 ? lines[1]?.split(";")[idx]?.trim() : null;
  return cell ? cell.toUpperCase() : null;
}

export function ImportDialog({
  open,
  onOpenChange,
  accounts,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
  onImported?: (summary: ImportSummary) => void;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<string>(NONE);
  const [detected, setDetected] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const { executeAsync: detect } = useAction(detectAccountAction);
  const { executeAsync: run, isPending } = useAction(importCsvAction);

  async function pick(f: File | null) {
    setFile(f);
    setSummary(null);
    if (!f) return;
    const currency = await firstRowCurrency(f);
    const r = await detect({ fileName: f.name, firstRowCurrency: currency });
    const id = r?.data?.data?.bankAccountId ?? null;
    setDetected(!!id);
    if (id) setAccountId(id);
  }

  async function submit() {
    if (!file || accountId === NONE) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("bankAccountId", accountId);
    const r = await run(fd);
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const s = r?.data?.data as ImportSummary | undefined;
    if (!s) return;
    setSummary(s);
    toast.success(
      t("banking.import.done", {
        imported: s.importedCount,
        duplicates: s.duplicateCount,
        errors: s.errorCount,
      }),
    );
    onImported?.(s);
    router.refresh();
  }

  function close(o: boolean) {
    if (!o) {
      setFile(null);
      setSummary(null);
      setDetected(null);
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>{t("banking.import.title")}</DialogTitle>
          <DialogDescription>{t("banking.import.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor={`${ids}-file`} className="mb-1 block text-xs font-medium">
              {t("banking.import.file")}
            </label>
            <Input
              id={`${ids}-file`}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
              data-testid="import-file"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-account`} className="mb-1 block text-xs font-medium">
              {t("banking.import.account")}
            </label>
            <Select value={accountId} onValueChange={(v) => setAccountId(v ?? NONE)}>
              <SelectTrigger id={`${ids}-account`} className="w-full" data-testid="import-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label} ({a.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {file && detected !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {detected ? t("banking.import.detected") : t("banking.import.notDetected")}
              </p>
            )}
          </div>

          {summary && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="import-summary">
              <div className="font-medium">
                {t("banking.import.done", {
                  imported: summary.importedCount,
                  duplicates: summary.duplicateCount,
                  errors: summary.errorCount,
                })}
              </div>
              <div className="text-muted-foreground">
                {summary.periodFrom &&
                  summary.periodTo &&
                  t("banking.import.period", { from: summary.periodFrom, to: summary.periodTo })}
                {summary.categorised > 0 &&
                  ` · ${t("banking.import.categorised", { count: summary.categorised })}`}
              </div>
              {summary.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs">{t("banking.import.errors")}</summary>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {summary.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            {summary ? (
              <Button
                type="button"
                onClick={() => {
                  close(false);
                  router.push(`/banking?f.bankImportId=in:${summary.id}`);
                }}
                data-testid="import-show-rows"
              >
                {t("banking.import.showRows")}
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!file || !accountId || isPending}
                data-testid="import-run"
              >
                {isPending ? t("banking.import.running") : t("banking.import.run")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
