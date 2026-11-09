"use client";

// Import Nordea exports — the page `/banking/import` (F156, the Pulse-Import board; was the dialog of F128 and D76
// phase 2b). Three steps: drop one or several CSVs → each file gets its section: the account pre-selected from the
// file name (and the first row's currency), still changeable → its PREVIEW (a read: the four tiles — balance chain,
// already imported, new rows, exchange rates —, what happens to the new rows as one bar, every row with its
// *Will be*; a refusal shown as the import would give it) → **Import N** writes the files one after the other, each
// all or nothing (F109) → the summary per file, with the total when there are several.
import { Ban, Check, FileUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
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

/** one file on the page — its account, its preview or refusal, its summary once imported */
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

/** What happens to the new rows, in the bar's order — the duplicates are not new rows. */
const OUTCOMES: Exclude<ImportPreviewVerdict, "duplicate">[] = [
  "category",
  "no_proof",
  "invoice",
  "new",
];
const OUTCOME_BAR: Record<(typeof OUTCOMES)[number], string> = {
  category: "bg-state-done",
  no_proof: "bg-state-neutral",
  invoice: "bg-state-progress",
  new: "bg-state-attention",
};
const OUTCOME_CHIP: Record<(typeof OUTCOMES)[number], string> = {
  category: "bg-state-done/15 text-state-done",
  no_proof: "bg-tag text-muted-foreground",
  invoice: "bg-state-progress/15 text-state-progress",
  new: "bg-state-attention/15 text-state-attention",
};

/** how many new rows of a preview will be what */
export function outcomesOf(preview: ImportPreview): [(typeof OUTCOMES)[number], number][] {
  const counts = new Map<ImportPreviewVerdict, number>();
  for (const r of preview.rows) counts.set(r.willBe, (counts.get(r.willBe) ?? 0) + 1);
  return OUTCOMES.flatMap((v) => (counts.get(v) ? [[v, counts.get(v) as number]] : []));
}

const isCsv = (f: File) => f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv";

export function ImportWorkbench({ accounts }: { accounts: AccountOption[] }) {
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

  function reset() {
    previewSeq.current.clear();
    setItems([]);
    setDone(false);
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

  const imported = items.flatMap((i) => (i.summary ? [i.summary] : []));
  const step = done ? 3 : items.length > 0 ? 2 : 1;

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="import-page"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Stepper step={step} />

      {/* the drop zone: the hero while nothing is dropped, then a line to add another file; a file already in the
          list is not added twice */}
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
            "flex items-center gap-3 rounded-2xl border border-dashed transition-colors",
            items.length === 0 ? "flex-col px-6 py-14 text-center" : "px-4 py-2.5",
            dragging ? "border-primary bg-selection" : "border-border bg-surface/60",
          )}
        >
          <FileUp
            className={cn("text-muted-foreground", items.length === 0 ? "size-7" : "size-4")}
            aria-hidden
          />
          <label
            htmlFor={`${ids}-file`}
            className={cn(items.length === 0 ? "text-[15px] font-medium" : "text-[13px]")}
          >
            {items.length === 0 ? t("banking.import.drop") : t("banking.import.dropMore")}
          </label>
          {items.length === 0 && (
            <p className="max-w-lg text-xs text-muted-foreground">
              {t("banking.import.description")}
            </p>
          )}
          <input
            id={`${ids}-file`}
            type="file"
            multiple
            accept=".csv,text/csv"
            className={cn(
              "text-xs file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1 file:text-[13px]",
              items.length > 0 && "ml-auto",
            )}
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

      {items.map((item) => (
        <FileSection
          key={item.key}
          item={item}
          accounts={accounts}
          idPrefix={`${ids}-${item.key}`}
          compact={items.length > 1}
          onAccount={(v) => changeAccount(item, v)}
          onRemove={done || isPending ? undefined : () => remove(item.key)}
        />
      ))}

      {items.length > 0 && (
        <div className="pulse-card sticky bottom-3 flex flex-wrap items-center gap-3 px-5 py-3.5">
          <p className="mr-auto text-xs text-muted-foreground">
            {done ? t("banking.import.doneHint") : t("banking.import.allOrNothing")}
          </p>
          {done ? (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                {t("banking.import.another")}
              </Button>
              {imported.length > 0 && (
                <Button
                  type="button"
                  onClick={() =>
                    router.push(`/banking?f.bankImportId=in:${imported.map((s) => s.id).join("|")}`)
                  }
                  data-testid="import-show-rows"
                >
                  {t("banking.import.showRows")}
                </Button>
              )}
            </>
          ) : (
            <>
              <Link href="/banking" className={buttonVariants({ variant: "outline" })}>
                {t("common.cancel")}
              </Link>
              <Button type="submit" disabled={!ready || isPending} data-testid="import-run">
                {isPending
                  ? t("banking.import.running")
                  : ready
                    ? pending.length > 1
                      ? t("banking.import.runFiles", { count: willImport, files: pending.length })
                      : t("banking.import.runCount", { count: willImport })
                    : t("banking.import.run")}
              </Button>
            </>
          )}
        </div>
      )}
    </form>
  );
}

/** Drop the file · Check the preview · Imported — where the page is. */
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const t = useT();
  const steps = [
    t("banking.import.step.drop"),
    t("banking.import.step.check"),
    t("banking.import.step.imported"),
  ];
  return (
    <ol className="flex items-center gap-3" data-testid="import-steps">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < step || step === 3 ? "done" : n === step ? "current" : "next";
        return (
          <li
            key={label}
            className="flex items-center gap-3"
            aria-current={state === "current" ? "step" : undefined}
          >
            {i > 0 && <span className="h-px w-14 bg-border" aria-hidden />}
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                state === "done" && "bg-state-done/15 text-state-done",
                state === "current" && "bg-foreground text-background",
                state === "next" && "border border-border text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3.5" aria-hidden /> : n}
            </span>
            <span
              className={cn(
                "text-[13px]",
                state === "current" ? "font-semibold" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One file: its card (name, account), then the tiles, what happens, the rows — or its summary once imported. */
function FileSection({
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
  /** several files: each one's rows fold behind *Show the rows* (its tiles and bar stay) */
  compact: boolean;
  onAccount: (v: string | null) => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const { preview, summary } = item;
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
    <section className="flex flex-col gap-4" data-testid="import-file-card">
      <div className="pulse-card flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-[10px] font-semibold text-muted-foreground"
          aria-hidden
        >
          CSV
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px]" title={item.file.name}>
            {item.file.name}
          </div>
          {preview && !summary && (
            <div
              className="mt-0.5 text-xs text-muted-foreground"
              data-testid="import-preview-header"
            >
              {headerLine}
            </div>
          )}
          {item.reading && !summary && (
            <p className="mt-0.5 text-xs text-muted-foreground" data-testid="import-reading">
              {t("banking.import.reading")}
            </p>
          )}
        </div>
        <div className="w-72 max-w-full">
          <label htmlFor={`${idPrefix}-account`} className="eyebrow mb-1 block">
            {t("banking.import.goesTo")}
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
            <p
              className={cn(
                "mt-1 text-xs",
                item.detected ? "text-state-done" : "text-state-attention",
              )}
            >
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

      {(item.refusal || item.error) && !summary && (
        <div
          role="alert"
          className="flex gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm"
          data-testid="import-refusal"
        >
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <div className="font-medium">{t("banking.import.refused")}</div>
            <div className="whitespace-pre-line break-words">{item.refusal ?? item.error}</div>
          </div>
        </div>
      )}

      {preview && !summary && <PreviewBody preview={preview} compact={compact} />}

      {summary && <SummaryCard summary={summary} />}
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  testId,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone?: "done" | "attention" | "progress";
  testId: string;
}) {
  return (
    <div
      className={cn(
        "pulse-card flex flex-col gap-1 px-4 py-3.5",
        tone === "done" && "border-state-done/40",
        tone === "attention" && "border-state-attention/50",
        tone === "progress" && "border-state-progress/40",
      )}
      data-testid={testId}
    >
      <span className="eyebrow">{label}</span>
      <span
        className={cn(
          "text-[22px] font-semibold tabular-nums",
          tone === "done" && "text-state-done",
          tone === "attention" && "text-state-attention",
        )}
      >
        {value}
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

/** The four tiles, what happens to the new rows, the rows — the file read, nothing written (F128). */
function PreviewBody({ preview, compact }: { preview: ImportPreview; compact: boolean }) {
  const t = useT();
  const [rowsOpen, setRowsOpen] = useState(false);
  const outcomes = outcomesOf(preview);
  const gaps = preview.balanceGaps.length;
  const gap = preview.balanceGaps[0];
  const fresh = preview.rows.filter((r) => !r.duplicate).map((r) => r.date);
  const firstNew = fresh.length > 0 ? fresh.reduce((a, b) => (a < b ? a : b)) : null;
  const lastNew = fresh.length > 0 ? fresh.reduce((a, b) => (a > b ? a : b)) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="import-preview">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          testId="import-tile-chain"
          label={t("banking.import.tile.chain")}
          tone={gaps > 0 ? "attention" : preview.completeTo ? "done" : undefined}
          value={
            gaps > 0
              ? t("banking.import.tile.gaps", { count: gaps })
              : preview.completeTo
                ? t("banking.import.tile.noGap")
                : "—"
          }
          sub={
            gap
              ? t("banking.import.tile.gapAt", { from: gap.from, to: gap.to })
              : preview.completeTo
                ? t("banking.import.tile.completeTo", { date: preview.completeTo })
                : t("banking.import.tile.noBalance")
          }
        />
        <Tile
          testId="import-tile-duplicates"
          label={t("banking.import.tile.already")}
          value={preview.duplicateCount}
          sub={
            preview.duplicateCount > 0
              ? t("banking.import.tile.alreadySub")
              : t("banking.import.tile.alreadyNone")
          }
        />
        <Tile
          testId="import-tile-new"
          label={t("banking.import.tile.new")}
          tone="progress"
          value={preview.willImport}
          sub={
            firstNew && lastNew
              ? t("banking.import.preview.period", { from: firstNew, to: lastNew })
              : t("banking.import.tile.newNone")
          }
        />
        <Tile
          testId="import-tile-rates"
          label={t("banking.import.tile.rates")}
          tone="done"
          value={t("banking.import.tile.ratesReady")}
          sub={t("banking.import.tile.ratesSub")}
        />
      </div>

      <div className="pulse-card flex flex-col gap-3 px-5 py-4">
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold">
          {t("banking.import.what", { count: preview.willImport })}
          <span className="text-xs font-normal text-muted-foreground">
            {t("banking.import.nothingWritten")}
          </span>
        </h2>
        {preview.willImport > 0 && (
          <>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {outcomes.map(([v, n]) => (
                <span key={v} className={OUTCOME_BAR[v]} style={{ flexGrow: n }} />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs" data-testid="import-tally">
              {outcomes.map(([v, n]) => (
                <li key={v} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-semibold tabular-nums",
                      OUTCOME_CHIP[v],
                    )}
                  >
                    {n}
                  </span>
                  {t(`banking.import.outcome.${v}`)}
                </li>
              ))}
            </ul>
          </>
        )}
        {compact && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="justify-self-start self-start px-0"
            aria-expanded={rowsOpen}
            onClick={() => setRowsOpen((o) => !o)}
          >
            {rowsOpen
              ? t("banking.import.hideRows")
              : t("banking.import.showFileRows", { count: preview.rows.length })}
          </Button>
        )}
        <div className={cn("max-h-[55vh] overflow-y-auto", compact && !rowsOpen && "hidden")}>
          {/* the kit's table parts on a bare <table>: the kit's wrapper would be a second scroll container and
              the sticky header would stick to it, not to this one (a long file scrolls here, lessons F125) */}
          <table className="w-full caption-bottom text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-surface">
              <TableRow>
                <TableHead className="eyebrow">{t("banking.import.preview.col.date")}</TableHead>
                <TableHead className="eyebrow">
                  {t("banking.import.preview.col.counterparty")}
                </TableHead>
                <TableHead className="eyebrow text-right">
                  {t("banking.import.preview.col.amount")}
                </TableHead>
                <TableHead className="eyebrow">{t("banking.import.preview.col.willBe")}</TableHead>
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
                    className={cn(
                      "border-b border-subtle",
                      row.duplicate && "text-muted-foreground",
                    )}
                  >
                    <TableCell className="tabular-nums">{row.date}</TableCell>
                    <TableCell className="max-w-[18rem] truncate" title={row.counterparty}>
                      {row.counterparty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.amount, row.currency, { signed: true })}
                    </TableCell>
                    <TableCell
                      className="max-w-[24rem] truncate"
                      data-testid="import-will-be"
                      title={t(m.key, m.params)}
                    >
                      {row.willBe !== "duplicate" && (
                        <span
                          className={cn(
                            "mr-2 inline-block size-2 rounded-full align-middle",
                            OUTCOME_BAR[row.willBe],
                          )}
                          aria-hidden
                        />
                      )}
                      {t(m.key, m.params)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ summary }: { summary: ImportSummary }) {
  const t = useT();
  return (
    <div className="pulse-card px-5 py-4 text-sm" data-testid="import-summary">
      <div className="flex items-center gap-2 font-medium">
        <Check className="size-4 text-state-done" aria-hidden />
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
  );
}
