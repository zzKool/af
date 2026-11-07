"use client";

// Import Nordea exports (F128, review 2026-10-31 §6.1; D76 phase 2b — several files at once): drop or pick one or
// several CSVs → each file gets its card: the account pre-selected from the file name (and the first row's
// currency), still changeable → its PREVIEW (a read: every row with its *Will be* — new · duplicate · no proof
// needed (rule, partner) · pays invoice … (proposed) —, the header line, the tally of what the rows will be, a
// refusal shown as the import would give it) → **Import N** writes the files one after the other, each all or
// nothing (F109) → the summary per file, with the total when there are several.
import { Ban, FileUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
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
import type {
  ImportPreview,
  ImportPreviewRow,
  ImportPreviewVerdict,
  ImportSummary,
} from "@/modules/banking/types";

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

/** one file in the dialog — its account, its preview or refusal, its summary once imported */
type FileItem = {
  key: string;
  file: File;
  accountId: string;
  detected: boolean | null;
  reading: boolean;
  preview: ImportPreview | null;
  refusal: string | null;
  summary: ImportSummary | null;
  /** the import itself failed (the preview passed): the message, the other files go on */
  error: string | null;
};

const TALLY_ORDER: ImportPreviewVerdict[] = ["new", "category", "no_proof", "invoice", "duplicate"];

/** how many rows of a preview will be what — `8 new · 2 no proof needed · 4 duplicates` */
function tallyOf(preview: ImportPreview): [ImportPreviewVerdict, number][] {
  const counts = new Map<ImportPreviewVerdict, number>();
  for (const r of preview.rows) counts.set(r.willBe, (counts.get(r.willBe) ?? 0) + 1);
  return TALLY_ORDER.flatMap((v) => (counts.get(v) ? [[v, counts.get(v) as number]] : []));
}

const isCsv = (f: File) => f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv";

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
  const [items, setItems] = useState<FileItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const { executeAsync: detect } = useAction(detectAccountAction);
  const { executeAsync: readFile } = useAction(previewImportAction);
  const { executeAsync: run, isPending } = useAction(importCsvAction);
  // per file, the newest preview request wins: an account picked while one is in flight drops its answer
  const previewSeq = useRef(new Map<string, number>());
  const keySeq = useRef(0);

  const update = (key: string, patch: Partial<FileItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function runPreview(key: string, f: File, accountId: string) {
    const seq = (previewSeq.current.get(key) ?? 0) + 1;
    previewSeq.current.set(key, seq);
    update(key, { reading: true, preview: null, refusal: null });
    const fd = new FormData();
    fd.set("file", f);
    fd.set("bankAccountId", accountId);
    const r = await readFile(fd);
    if (previewSeq.current.get(key) !== seq) return;
    const error = extractError(r);
    if (error) {
      update(key, { reading: false, refusal: error });
      return;
    }
    const p = r?.data?.data as ImportPreview | undefined;
    update(key, { reading: false, preview: p ?? null });
  }

  async function addFiles(files: File[]) {
    if (done) {
      setItems([]);
      setDone(false);
    }
    const known = new Set(done ? [] : items.map((i) => i.file.name));
    const fresh = files.filter((f) => isCsv(f) && !known.has(f.name));
    const added = fresh.map((file) => ({
      key: `f${++keySeq.current}`,
      file,
      accountId: NONE,
      detected: null,
      reading: true,
      preview: null,
      refusal: null,
      summary: null,
      error: null,
    }));
    setItems((list) => [...(done ? [] : list), ...added]);
    await Promise.all(
      added.map(async (item) => {
        const currency = await firstRowCurrency(item.file);
        const r = await detect({ fileName: item.file.name, firstRowCurrency: currency });
        const id = r?.data?.data?.bankAccountId ?? null;
        update(item.key, { detected: !!id, accountId: id ?? NONE, reading: !!id });
        if (id) await runPreview(item.key, item.file, id);
      }),
    );
  }

  function changeAccount(item: FileItem, v: string | null) {
    const id = v ?? NONE;
    update(item.key, { accountId: id });
    if (id !== NONE) void runPreview(item.key, item.file, id);
    else {
      previewSeq.current.set(item.key, (previewSeq.current.get(item.key) ?? 0) + 1);
      update(item.key, { preview: null, refusal: null, reading: false });
    }
  }

  function remove(key: string) {
    previewSeq.current.delete(key);
    setItems((list) => list.filter((i) => i.key !== key));
  }

  const pending = items.filter((i) => !i.summary);
  const ready =
    pending.length > 0 &&
    pending.every((i) => i.accountId !== NONE && i.preview && !i.refusal && !i.reading);
  const willImport = pending.reduce((n, i) => n + (i.preview?.willImport ?? 0), 0);

  async function submit() {
    if (!ready) return;
    const summaries: ImportSummary[] = [];
    // one file after the other: each is its own transaction (F109) — a failed one does not undo the others
    for (const item of pending) {
      const fd = new FormData();
      fd.set("file", item.file);
      fd.set("bankAccountId", item.accountId);
      const r = await run(fd);
      const error = extractError(r);
      if (error) {
        update(item.key, { error });
        toast.error(`${item.file.name}: ${error}`);
        continue;
      }
      const s = r?.data?.data as ImportSummary | undefined;
      if (!s) continue;
      summaries.push(s);
      update(item.key, { summary: s, preview: null, error: null });
      onImported?.(s);
    }
    setDone(true);
    if (summaries.length > 0) {
      const sum = (k: "importedCount" | "duplicateCount" | "errorCount") =>
        summaries.reduce((n, s) => n + s[k], 0);
      toast.success(
        summaries.length === 1
          ? t("banking.import.done", {
              imported: sum("importedCount"),
              duplicates: sum("duplicateCount"),
              errors: sum("errorCount"),
            })
          : t("banking.import.doneMany", {
              files: summaries.length,
              imported: sum("importedCount"),
              duplicates: sum("duplicateCount"),
              errors: sum("errorCount"),
            }),
      );
    }
    router.refresh();
  }

  function close(o: boolean) {
    if (!o) {
      previewSeq.current.clear();
      setItems([]);
      setDone(false);
      setDragging(false);
    }
    onOpenChange(o);
  }

  const imported = items.flatMap((i) => (i.summary ? [i.summary] : []));
  const wide = items.some((i) => i.preview && !i.summary);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        data-testid="import-dialog"
        size="lg"
        className={cn(wide && "data-[size=lg]:max-w-4xl")}
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
          {/* the drop zone: one or several CSVs, dropped or picked; a file already in the list is not added twice */}
          {!done && (
            // biome-ignore lint/a11y/noStaticElementInteractions: the drop target wraps a real file input, which stays the keyboard path
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles([...e.dataTransfer.files]);
              }}
              data-testid="import-drop"
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-4 text-center transition-colors",
                dragging ? "border-primary bg-selection" : "border-border bg-surface-2",
              )}
            >
              <FileUp className="size-5 text-muted-foreground" aria-hidden />
              <label htmlFor={`${ids}-file`} className="text-[13px]">
                {t("banking.import.drop")}
              </label>
              <Input
                id={`${ids}-file`}
                type="file"
                multiple
                accept=".csv,text/csv"
                className="max-w-sm"
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
                data-testid="import-file"
              />
            </div>
          )}

          {imported.length > 1 && (
            <div className="text-sm font-medium" data-testid="import-summary-total">
              {t("banking.import.doneMany", {
                files: imported.length,
                imported: imported.reduce((n, s) => n + s.importedCount, 0),
                duplicates: imported.reduce((n, s) => n + s.duplicateCount, 0),
                errors: imported.reduce((n, s) => n + s.errorCount, 0),
              })}
            </div>
          )}

          <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
            {items.map((item) => (
              <FileCard
                key={item.key}
                item={item}
                accounts={accounts}
                idPrefix={`${ids}-${item.key}`}
                compact={items.length > 1}
                onAccount={(v) => changeAccount(item, v)}
                onRemove={done || isPending ? undefined : () => remove(item.key)}
              />
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {done ? t("common.close") : t("common.cancel")}
            </Button>
            {done ? (
              imported.length > 0 && (
                <Button
                  type="button"
                  onClick={() => {
                    close(false);
                    router.push(
                      `/banking?f.bankImportId=in:${imported.map((s) => s.id).join("|")}`,
                    );
                  }}
                  data-testid="import-show-rows"
                >
                  {t("banking.import.showRows")}
                </Button>
              )
            ) : (
              <Button type="submit" disabled={!ready || isPending} data-testid="import-run">
                {isPending
                  ? t("banking.import.running")
                  : ready
                    ? pending.length > 1
                      ? t("banking.import.runFiles", { count: willImport, files: pending.length })
                      : t("banking.import.runCount", { count: willImport })
                    : t("banking.import.run")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One file's card: name, account, the preview (or the refusal), then its summary once imported. */
function FileCard({
  item,
  accounts,
  idPrefix,
  compact,
  onAccount,
  onRemove,
}: {
  item: FileItem;
  accounts: AccountOption[];
  idPrefix: string;
  /** several files: each one's rows fold behind *Show the rows* (its tally and header line stay) */
  compact: boolean;
  onAccount: (v: string | null) => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const { preview, summary } = item;
  const [rowsOpen, setRowsOpen] = useState(false);
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
    <section
      className="grid gap-2.5 rounded-xl border border-subtle bg-surface p-3"
      data-testid="import-file-card"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs" title={item.file.name}>
            {item.file.name}
          </div>
          {preview && !summary && (
            <div
              className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs"
              data-testid="import-tally"
            >
              {tallyOf(preview).map(([v, n]) => (
                <span key={v} className={cn(v === "duplicate" && "text-muted-foreground")}>
                  {t(`banking.import.tally.${v}`, { count: n })}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="w-64 max-w-full">
          <label htmlFor={`${idPrefix}-account`} className="sr-only">
            {t("banking.import.account")}
          </label>
          <Select value={item.accountId} onValueChange={onAccount} disabled={!!summary}>
            <SelectTrigger
              id={`${idPrefix}-account`}
              className="w-full"
              data-testid="import-account"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("banking.import.account")} —</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label} ({a.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {item.detected !== null && !summary && (
            <p className="mt-1 text-xs text-muted-foreground">
              {item.detected ? t("banking.import.detected") : t("banking.import.notDetected")}
            </p>
          )}
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("banking.import.remove", { file: item.file.name })}
            onClick={onRemove}
          >
            <X />
          </Button>
        )}
      </div>

      {/* the preview step: the file read against the account, nothing written (F128) */}
      {item.reading && !summary && (
        <p className="text-sm text-muted-foreground" data-testid="import-reading">
          {t("banking.import.reading")}
        </p>
      )}
      {(item.refusal || item.error) && !summary && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          data-testid="import-refusal"
        >
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <div className="font-medium">{t("banking.import.refused")}</div>
            <div className="whitespace-pre-line break-words">{item.refusal ?? item.error}</div>
          </div>
        </div>
      )}
      {preview && !summary && (
        <div className="grid gap-2" data-testid="import-preview">
          <div className="text-sm text-muted-foreground" data-testid="import-preview-header">
            {headerLine}
          </div>
          {compact && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="justify-self-start"
              aria-expanded={rowsOpen}
              onClick={() => setRowsOpen((o) => !o)}
            >
              {rowsOpen
                ? t("banking.import.hideRows")
                : t("banking.import.showFileRows", { count: preview.rows.length })}
            </Button>
          )}
          <div
            className={cn(
              "max-h-[40vh] overflow-y-auto rounded-md border",
              compact && !rowsOpen && "hidden",
            )}
          >
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
        <div className="rounded-md bg-surface-2 p-3 text-sm" data-testid="import-summary">
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
                <li>{t("banking.import.moreGaps", { count: summary.balanceGaps.length - 5 })}</li>
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
    </section>
  );
}
