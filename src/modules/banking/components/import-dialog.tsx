"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
// Import a Nordea export (F128, review 2026-10-31 §6.1): pick the file → the account is pre-selected from the file
// name (and the first row's currency) → the PREVIEW (a read: every row with its *Will be* — new · duplicate · no
// proof needed (rule, partner) · pays invoice … (proposed) —, the header line, the account still changeable, a
// refusal shown as the import would give it) → **Import N** writes, all or nothing (F109) → the summary.
import { useAction } from "next-safe-action/hooks";
import { useId, useRef, useState } from "react";
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import {
  detectAccountAction,
  importCsvAction,
  previewImportAction,
} from "@/modules/banking/banking.actions";
import type { ImportPreview, ImportPreviewRow, ImportSummary } from "@/modules/banking/types";

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

/** The *Will be* words of one previewed row — the verdict is the service's, the text is the dictionary's. */
export function willBeMessage(row: ImportPreviewRow): { key: MessageKey; params?: MessageParams } {
  switch (row.willBe) {
    case "duplicate":
      return { key: "banking.import.willBe.duplicate" };
    case "invoice":
      return {
        key: "banking.import.willBe.invoice",
        params: { number: row.invoice?.number ?? "" },
      };
    case "no_proof":
      return row.rule?.partnerName
        ? {
            key: "banking.import.willBe.noProof",
            params: { rule: row.rule.ruleName, partner: row.rule.partnerName },
          }
        : {
            key: "banking.import.willBe.noProofNoPartner",
            params: { rule: row.rule?.ruleName ?? "" },
          };
    case "category": {
      const rule = row.rule?.ruleName ?? "";
      const category = row.rule?.basLabel ?? row.rule?.basCode ?? null;
      const partner = row.rule?.partnerName ?? null;
      if (category && partner)
        return {
          key: "banking.import.willBe.categoryPartner",
          params: { category, rule, partner },
        };
      if (category) return { key: "banking.import.willBe.category", params: { category, rule } };
      return { key: "banking.import.willBe.partnerOnly", params: { partner: partner ?? "", rule } };
    }
    default:
      return { key: "banking.import.willBe.new" };
  }
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
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const { executeAsync: detect } = useAction(detectAccountAction);
  const { executeAsync: readFile, isPending: reading } = useAction(previewImportAction);
  const { executeAsync: run, isPending } = useAction(importCsvAction);
  // the newest preview request wins: a file or an account picked while one is in flight drops its answer
  const previewSeq = useRef(0);

  async function runPreview(f: File, id: string) {
    const seq = ++previewSeq.current;
    setPreview(null);
    setRefusal(null);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("bankAccountId", id);
    const r = await readFile(fd);
    if (seq !== previewSeq.current) return;
    const error = extractError(r);
    if (error) {
      setRefusal(error);
      return;
    }
    const p = r?.data?.data as ImportPreview | undefined;
    if (p) setPreview(p);
  }

  async function pick(f: File | null) {
    setFile(f);
    setSummary(null);
    setPreview(null);
    setRefusal(null);
    if (!f) return;
    const currency = await firstRowCurrency(f);
    const r = await detect({ fileName: f.name, firstRowCurrency: currency });
    const id = r?.data?.data?.bankAccountId ?? null;
    setDetected(!!id);
    if (id) setAccountId(id);
    const target = id ?? (accountId !== NONE ? accountId : null);
    if (target) void runPreview(f, target);
  }

  function changeAccount(v: string | null) {
    const id = v ?? NONE;
    setAccountId(id);
    setSummary(null);
    if (file && id !== NONE) void runPreview(file, id);
    else {
      setPreview(null);
      setRefusal(null);
    }
  }

  async function submit() {
    if (!file || accountId === NONE || !preview) return;
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
    setPreview(null);
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
      previewSeq.current++;
      setFile(null);
      setSummary(null);
      setPreview(null);
      setRefusal(null);
      setDetected(null);
    }
    onOpenChange(o);
  }

  const headerLine = preview
    ? [
        t("banking.import.preview.rows", { count: preview.recordCount }),
        preview.periodFrom && preview.periodTo
          ? t("banking.import.preview.period", { from: preview.periodFrom, to: preview.periodTo })
          : null,
        preview.completeTo
          ? t("banking.import.preview.chain", { date: preview.completeTo })
          : t("banking.import.preview.noChain"),
        preview.balanceGaps.length > 0
          ? t("banking.import.preview.chainGaps", { count: preview.balanceGaps.length })
          : null,
        preview.duplicateCount > 0
          ? t("banking.import.preview.duplicates", { count: preview.duplicateCount })
          : null,
      ]
        .filter((s): s is string => !!s)
        .join(" · ")
    : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        data-testid="import-dialog"
        size="lg"
        className={cn(preview && !summary && "data-[size=lg]:max-w-4xl")}
      >
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
          <div className="grid gap-3 sm:grid-cols-2">
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
              <Select value={accountId} onValueChange={changeAccount} disabled={!!summary}>
                <SelectTrigger
                  id={`${ids}-account`}
                  className="w-full"
                  data-testid="import-account"
                >
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
          </div>

          {/* the preview step: the file read against the account, nothing written (F128) */}
          {reading && !summary && (
            <p className="text-sm text-muted-foreground" data-testid="import-reading">
              {t("banking.import.reading")}
            </p>
          )}
          {refusal && !summary && (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
              data-testid="import-refusal"
            >
              <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0">
                <div className="font-medium">{t("banking.import.refused")}</div>
                <div className="whitespace-pre-line break-words">{refusal}</div>
              </div>
            </div>
          )}
          {preview && !summary && (
            <div className="grid gap-2" data-testid="import-preview">
              <div className="text-sm text-muted-foreground" data-testid="import-preview-header">
                {headerLine}
              </div>
              <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                {/* the kit's table parts on a bare <table>: the kit's wrapper would be a second scroll container and
                    the sticky header would stick to it, not to this one (a long file scrolls here, lessons F125) */}
                <table className="w-full caption-bottom text-[13px]">
                  <TableHeader className="sticky top-0 z-10 bg-surface">
                    <TableRow>
                      <TableHead>{t("banking.import.preview.col.date")}</TableHead>
                      <TableHead className="text-right">
                        {t("banking.import.preview.col.amount")}
                      </TableHead>
                      <TableHead>{t("banking.import.preview.col.counterparty")}</TableHead>
                      <TableHead>{t("banking.import.preview.col.willBe")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => {
                      const m = willBeMessage(row);
                      return (
                        <TableRow
                          key={row.rowIndex}
                          data-testid="import-preview-row"
                          data-will-be={row.willBe}
                          className={cn(row.duplicate && "text-muted-foreground")}
                        >
                          <TableCell className="tabular-nums">{row.date}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.amount, row.currency, { signed: true })}
                          </TableCell>
                          <TableCell className="max-w-[16rem] truncate" title={row.counterparty}>
                            {row.counterparty}
                          </TableCell>
                          <TableCell
                            className="max-w-[20rem] truncate"
                            data-testid="import-will-be"
                            title={t(m.key, m.params)}
                          >
                            {t(m.key, m.params)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
          )}

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
              {/* F115: the balance chain after this import — how far the account is proven, the gaps */}
              <div className="text-muted-foreground" data-testid="import-chain">
                {summary.completeTo
                  ? t("banking.import.completeTo", { date: summary.completeTo })
                  : t("banking.import.noChain")}
              </div>
              {summary.balanceGaps.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs" data-testid="import-gaps">
                  {summary.balanceGaps.slice(0, 5).map((g) => (
                    <li key={`${g.from}-${g.to}`}>
                      {t("banking.import.gap", {
                        from: g.from,
                        to: g.to,
                        difference: formatMoney(g.difference, summary.currency, { signed: true }),
                      })}
                    </li>
                  ))}
                  {summary.balanceGaps.length > 5 && (
                    <li>
                      {t("banking.import.moreGaps", { count: summary.balanceGaps.length - 5 })}
                    </li>
                  )}
                </ul>
              )}
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
                disabled={!file || accountId === NONE || !preview || reading || isPending}
                data-testid="import-run"
              >
                {isPending
                  ? t("banking.import.running")
                  : preview
                    ? t("banking.import.runCount", { count: preview.willImport })
                    : t("banking.import.run")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
