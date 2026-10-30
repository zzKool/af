"use client";

// The document inbox (specs/documents US4, D32, D34): every document that still needs a decision on the left —
// tabs with counts, search, selection — the open one on the right with its preview, facts, the bank rows that
// could justify it and the actions its state allows. Keyboard first, shaped like /banking/inbox. Archive and
// restore go on an undo stack that lives as long as the page. The accountant reads, nothing more.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import {
  archiveDocumentsAction,
  listInboxAction,
  markDocumentReviewedAction,
  runOcrAction,
  unarchiveDocumentsAction,
} from "@/modules/documents/documents.actions";
import { documentFileUrl } from "@/modules/documents/file";
import type { InboxState, InboxTab } from "@/modules/documents/inbox";
import type { InboxData, InboxItem } from "@/modules/documents/queries";
import { NewExpenseDialog } from "@/modules/expenses/ui";
import { SuggestionsSection } from "@/modules/linking/ui";
import { NewSupplierInvoiceDialog } from "@/modules/supplier-invoices/ui";
import { DocumentStateLabel } from "./document-state-label";
import { initialFromFacts, type MakeItOptions } from "./make-it-section";

const DocumentPreview = dynamic(() => import("@/modules/documents/components/document-preview"), {
  ssr: false,
  loading: () => <div className="aspect-[3/4] animate-pulse rounded-lg bg-muted" />,
});

export const INBOX_UNDO_MAX = 20;
const TABS: readonly InboxTab[] = ["all", "pending", "ready", "duplicates", "archived"];
const PENDING: readonly InboxState[] = ["needs_ocr", "processing", "stuck", "ocr_failed"];

/** The keyboard map (FR-022); the accountant's help lists the reading keys only (US4-7). */
const KEYS: { keys: string; label: MessageKey; write: boolean }[] = [
  { keys: "j / ↓ · k / ↑", label: "documents.inbox.help.move", write: false },
  { keys: "x", label: "documents.inbox.help.select", write: true },
  { keys: "a", label: "documents.inbox.help.selectAll", write: true },
  { keys: "o", label: "documents.inbox.help.ocr", write: true },
  { keys: "e", label: "documents.inbox.help.expense", write: true },
  { keys: "i", label: "documents.inbox.help.supplier", write: true },
  { keys: "l", label: "documents.inbox.help.link", write: true },
  { keys: "Enter", label: "documents.inbox.help.enter", write: true },
  { keys: "1 – 3", label: "documents.inbox.help.nth", write: true },
  { keys: "d", label: "documents.inbox.help.archive", write: true },
  { keys: "r", label: "documents.inbox.help.restore", write: true },
  { keys: "u / z", label: "documents.inbox.help.undo", write: true },
  { keys: "?", label: "documents.inbox.help.help", write: false },
  { keys: "Esc", label: "documents.inbox.help.esc", write: false },
];

/** Typing in a field, or inside a dialog / an open list: the page's keys stay quiet (`Esc` included — the
 *  dialog closes itself). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    !!el.closest("[role=dialog]") ||
    !!el.closest("[role=alertdialog]") ||
    !!el.closest("[role=listbox]")
  );
}

type UndoEntry = { kind: "archive" | "restore"; ids: string[] };

/** On-screen money (D40); an OCR amount the formatter refuses shows as it came rather than breaking the pane. */
function money(amount: string, currency: string | null): string {
  try {
    return formatMoney(amount, currency);
  } catch {
    return currency ? `${amount} ${currency}` : amount;
  }
}

export function InboxWorkbench({
  initial,
  canWrite,
  options,
}: {
  initial: InboxData;
  canWrite: boolean;
  /** the two creation dialogs' option lists (owner only) */
  options: MakeItOptions | null;
}) {
  const t = useT();
  const [data, setData] = useState<InboxData>(initial);
  const [tab, setTab] = useState<InboxTab>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(initial.rows[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const [dialog, setDialog] = useState<"expense" | "supplier" | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [openSearchKey, setOpenSearchKey] = useState(0);
  const [applyRequest, setApplyRequest] = useState<
    { index: number; requireHigh: boolean; seq: number; needsHighMessage?: string } | undefined
  >(undefined);
  const listRef = useRef<HTMLUListElement>(null);
  const loadSeq = useRef(0);

  const { executeAsync: load } = useAction(listInboxAction);
  const { executeAsync: archive, isPending: archiving } = useAction(archiveDocumentsAction);
  const { executeAsync: unarchive, isPending: restoring } = useAction(unarchiveDocumentsAction);
  const { executeAsync: runOcr, isPending: ocrRunning } = useAction(runOcrAction);
  const { executeAsync: markReviewed, isPending: filing } = useAction(markDocumentReviewedAction);

  const rows = data.rows;
  const index = rows.findIndex((r) => r.id === openId);
  const open = index >= 0 ? (rows[index] ?? null) : null;

  const reload = useCallback(
    async (next?: { tab?: InboxTab; q?: string }) => {
      const mine = ++loadSeq.current;
      const r = await load({ tab: next?.tab ?? tab, q: (next?.q ?? q).trim() || undefined });
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (d && mine === loadSeq.current) setData(d);
    },
    [load, tab, q],
  );

  // the list changes under the pane (a row archived, made into something): the next row opens in its place —
  // unless the owner closed the pane (Esc), which stays closed until he moves again
  const paneClosed = useRef(false);
  const lastIndex = useRef(0);
  if (index >= 0) lastIndex.current = index;
  useEffect(() => {
    if (openId && rows.some((r) => r.id === openId)) return;
    if (!openId && paneClosed.current) return;
    const at = Math.min(lastIndex.current, rows.length - 1);
    setOpenId(at >= 0 ? (rows[at]?.id ?? null) : null);
  }, [rows, openId]);
  useEffect(() => {
    setChecked((c) => {
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...c].filter((id) => visible.has(id)));
      return next.size === c.size ? c : next;
    });
  }, [rows]);

  // the search reloads once typing pauses
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    const h = setTimeout(() => void reload({ q }), 250);
    return () => clearTimeout(h);
  }, [q, reload]);

  function switchTab(next: InboxTab) {
    if (next === tab) return;
    setTab(next);
    setChecked(new Set());
    void reload({ tab: next });
  }

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const from = index < 0 ? (delta > 0 ? -1 : 0) : index;
      const next = (from + delta + rows.length) % rows.length; // wraps (US4-3)
      const id = rows[next]?.id ?? null;
      paneClosed.current = false;
      setOpenId(id);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
    },
    [rows, index],
  );

  function toggle(id: string, on?: boolean) {
    setChecked((c) => {
      const next = new Set(c);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** archive or restore `ids`; the undo entry holds exactly the ones that succeeded (FR-020) */
  const park = useCallback(
    async (kind: "archive" | "restore", ids: string[], fromUndo = false) => {
      if (!canWrite || ids.length === 0) return;
      const r = kind === "archive" ? await archive({ ids }) : await unarchive({ ids });
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      const outcomes = r?.data && "data" in r.data ? (r.data.data ?? []) : [];
      const done = outcomes
        .filter((o) => o.outcome === (kind === "archive" ? "archived" : "restored"))
        .map((o) => o.id);
      const refused = outcomes.length - done.length;
      if (fromUndo) {
        if (refused > 0)
          toast.message(t("documents.inbox.toast.undonePartial", { count: done.length, refused }));
        else toast.success(t("documents.inbox.toast.undone"));
      } else {
        if (done.length > 0)
          setUndoStack((s) => [...s, { kind, ids: done }].slice(-INBOX_UNDO_MAX));
        const key =
          kind === "archive"
            ? refused > 0
              ? "documents.inbox.toast.archivedRefused"
              : "documents.inbox.toast.archived"
            : refused > 0
              ? "documents.inbox.toast.restoredRefused"
              : "documents.inbox.toast.restored";
        if (done.length === 0) toast.error(t(`documents.inbox.toast.${kind}None`));
        else (refused > 0 ? toast.message : toast.success)(t(key, { count: done.length, refused }));
      }
      setChecked(new Set());
      await reload();
    },
    [archive, unarchive, canWrite, reload, t],
  );

  const undoLast = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) {
      toast.message(t("documents.inbox.toast.nothingToUndo"));
      return;
    }
    setUndoStack((s) => s.slice(0, -1));
    await park(last.kind === "archive" ? "restore" : "archive", last.ids, true);
  }, [undoStack, park, t]);

  const ocr = useCallback(
    async (row: InboxItem) => {
      if (!canWrite) return;
      if (!["needs_ocr", "stuck", "ocr_failed"].includes(row.state)) {
        toast.message(t("documents.inbox.toast.ocrNotNow"));
        return;
      }
      const r = await runOcr({ documentId: row.id });
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(t("documents.inbox.toast.ocrStarted", { key: row.businessKey }));
      await reload();
    },
    [canWrite, runOcr, reload, t],
  );

  async function justFile(row: InboxItem) {
    const r = await markReviewed({ documentId: row.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("documents.inbox.toast.filed", { key: row.businessKey }));
    await reload();
  }

  const canFile = (row: InboxItem | null) =>
    !!row && canWrite && !!options && (row.state === "ready" || row.state === "ocr_failed");
  // a relationship document (contract, NDA) becomes nothing: it is filed or archived
  const canMake = (row: InboxItem | null) => canFile(row) && row?.documentType === "financial";
  const canLink = (row: InboxItem | null) =>
    !!row && row.state === "ready" && row.documentType === "financial";
  const selection = checked.size > 0 ? [...checked] : null;

  // the keyboard (FR-022): quiet while typing or inside a dialog; the accountant has j k ? Esc only
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || dialog) return;
      const key = e.key;
      if (key === "?") {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      if (helpOpen) return; // the help dialog closes on Esc by itself
      if (key === "Escape") {
        if (openId) {
          paneClosed.current = true;
          setOpenId(null);
        } else if (checked.size > 0) setChecked(new Set());
        return;
      }
      if (key === "j" || key === "ArrowDown") {
        e.preventDefault();
        move(1);
        return;
      }
      if (key === "k" || key === "ArrowUp") {
        e.preventDefault();
        move(-1);
        return;
      }
      if (!canWrite) return;
      if (key === "x" && open) {
        e.preventDefault();
        toggle(open.id);
      } else if (key === "a") {
        e.preventDefault();
        setChecked((c) =>
          c.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((r) => r.id)),
        );
      } else if (key === "o" && open) {
        e.preventDefault();
        void ocr(open);
      } else if ((key === "e" || key === "i") && open) {
        e.preventDefault();
        if (canMake(open)) setDialog(key === "e" ? "expense" : "supplier");
      } else if (key === "l" && open && canLink(open)) {
        e.preventDefault();
        setOpenSearchKey((k) => k + 1);
      } else if (key === "d") {
        e.preventDefault();
        if (tab === "archived") return;
        const ids = selection ?? (open ? [open.id] : []);
        void park("archive", ids);
      } else if (key === "r") {
        e.preventDefault();
        if (tab === "archived" && selection) void park("restore", selection);
        else void reload().then(() => toast.message(t("documents.inbox.toast.refreshed")));
      } else if (key === "u" || key === "z") {
        e.preventDefault();
        void undoLast();
      } else if ((key === "Enter" || /^[1-3]$/.test(key)) && open && canLink(open)) {
        e.preventDefault();
        setApplyRequest((prev) => ({
          index: key === "Enter" ? 0 : Number(key) - 1,
          requireHigh: key === "Enter",
          seq: (prev?.seq ?? 0) + 1,
          needsHighMessage: t("documents.inbox.enterNeedsHigh"),
        }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const makeInitial = useMemo(
    () => (open ? initialFromFacts(open.id, open.businessKey, open.facts) : null),
    [open],
  );
  const counts = data.counts;
  const countOf: Record<InboxTab, number> = {
    all: counts.total,
    pending: counts.pending,
    ready: counts.ready,
    duplicates: counts.duplicates,
    archived: counts.archived,
  };
  const lastUndo = undoStack[undoStack.length - 1];

  return (
    <div className="flex flex-col gap-3" data-testid="document-inbox">
      {/* tabs, search, help */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* D40 underline tabs, the kit's look (the counts are in the words until F74 splits them into badges) */}
        <div className="flex h-9 flex-wrap items-stretch gap-4 border-b" role="tablist">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => switchTab(k)}
              data-testid={`inbox-tab-${k}`}
              className={`relative -mb-px border-b-2 px-0.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 ${
                tab === k
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`documents.inbox.tab.${k}`, { count: countOf[k] })}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="h-8 w-64"
            placeholder={t("documents.inbox.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("documents.inbox.search")}
            data-testid="inbox-search"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setHelpOpen(true)}
            aria-label={t("documents.inbox.help.title")}
            title={t("documents.inbox.help.title")}
          >
            ?
          </Button>
        </div>
      </div>

      {/* the bulk bar and the undo bar */}
      {canWrite && (checked.size > 0 || lastUndo) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm"
          data-testid="inbox-bar"
        >
          {checked.size > 0 && (
            <>
              <span>{t("documents.inbox.selected", { count: checked.size })}</span>
              {tab === "archived" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restoring}
                  onClick={() => void park("restore", [...checked])}
                  data-testid="bulk-restore"
                >
                  {t("documents.inbox.action.restore")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={archiving}
                  onClick={() => void park("archive", [...checked])}
                  data-testid="bulk-archive"
                >
                  {t("documents.inbox.action.archive")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                {t("documents.inbox.clearSelection")}
              </Button>
            </>
          )}
          {lastUndo && (
            <span className="ml-auto flex items-center gap-2" data-testid="inbox-undo">
              <span className="text-muted-foreground">
                {t(
                  lastUndo.kind === "archive"
                    ? "documents.inbox.undo.archived"
                    : "documents.inbox.undo.restored",
                  { count: lastUndo.ids.length },
                )}
              </span>
              <Button size="sm" variant="outline" onClick={() => void undoLast()}>
                {t("documents.inbox.undo.button")}
              </Button>
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* left: the queue */}
        <section className="min-w-0 rounded-md border" aria-label={t("documents.inbox.title")}>
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground" data-testid="inbox-empty">
              {t(
                tab === "all"
                  ? "documents.inbox.empty.all"
                  : tab === "archived"
                    ? "documents.inbox.empty.archived"
                    : tab === "duplicates"
                      ? "documents.inbox.empty.duplicates"
                      : "documents.inbox.empty.tab",
              )}
            </p>
          ) : (
            <ul ref={listRef} className="max-h-[75vh] divide-y overflow-auto text-sm">
              {rows.map((r) => {
                const active = r.id === openId;
                return (
                  <li
                    key={r.id}
                    data-row-id={r.id}
                    data-testid="inbox-row"
                    data-state={active ? "selected" : undefined}
                    data-inbox-state={r.state}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${active ? "bg-selection" : "hover:bg-hover"}`}
                    onClick={() => {
                      paneClosed.current = false;
                      setOpenId(r.id);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}
                  >
                    {canWrite && (
                      <Checkbox
                        className="mt-1"
                        checked={checked.has(r.id)}
                        onCheckedChange={(v) => toggle(r.id, v === true)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${t("documents.inbox.select")} ${r.businessKey}`}
                        data-testid="inbox-row-check"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CodeChip>{r.businessKey}</CodeChip>
                        <DocumentStateLabel state={r.state} testId="inbox-state" />
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                          {/* yyyy-mm-dd (D40), the same day the library's Uploaded column shows */}
                          {r.createdAt.slice(0, 10)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <Tag>{t(`documents.prefix.${r.prefixType}` as MessageKey)}</Tag>
                        <span className="truncate" title={r.fileName}>
                          {r.fileName}
                        </span>
                      </div>
                      {(r.vendor || r.amount || r.documentDate) && (
                        <div className="truncate text-xs tabular-nums">
                          {[r.vendor, r.amount ? money(r.amount, r.currency) : null, r.documentDate]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                      {r.state === "stuck" && (
                        <div className="text-xs text-muted-foreground">
                          {t("documents.inbox.stuck")}
                        </div>
                      )}
                      {r.duplicateOf && (
                        <div className="text-xs text-muted-foreground" data-testid="inbox-dup">
                          {t("documents.inbox.duplicateOf", { key: r.duplicateOf.businessKey })}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* right: the open document */}
        <section className="min-w-0" aria-label={t("documents.inbox.pane")}>
          {open ? (
            <InboxPane
              key={open.id}
              row={open}
              canWrite={canWrite}
              canMake={canMake(open)}
              canFile={canFile(open)}
              canLink={canLink(open)}
              busy={archiving || restoring || ocrRunning || filing}
              openSearchKey={openSearchKey}
              applyRequest={applyRequest}
              onOcr={() => void ocr(open)}
              onMake={(d) => setDialog(d)}
              onFile={() => void justFile(open)}
              onArchive={() => void park("archive", [open.id])}
              onRestore={() => void park("restore", [open.id])}
              onLinked={() => void reload()}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("documents.inbox.selectDocument")}</p>
          )}
        </section>
      </div>

      {/* Make it… — the modules' own dialogs, pre-filled from the open document */}
      {options && makeInitial && open && (
        <>
          <NewExpenseDialog
            open={dialog === "expense"}
            onOpenChange={(o) => setDialog(o ? "expense" : null)}
            groups={options.expense.groups}
            categories={options.expense.categories}
            sources={options.expense.sources}
            basHistory={options.expense.basHistory}
            documents={[]}
            initial={makeInitial.expense}
            onCreated={() => void reload()}
          />
          <NewSupplierInvoiceDialog
            open={dialog === "supplier"}
            onOpenChange={(o) => setDialog(o ? "supplier" : null)}
            groups={options.supplier.groups}
            categories={options.supplier.categories}
            suppliers={options.supplier.suppliers}
            registrations={options.supplier.registrations}
            basHistory={options.supplier.basHistory}
            documents={[]}
            initial={makeInitial.supplier}
            onCreated={() => void reload()}
          />
        </>
      )}

      {/* the keyboard help */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent data-testid="inbox-help">
          <DialogHeader>
            <DialogTitle>{t("documents.inbox.help.title")}</DialogTitle>
            <DialogDescription>{t("documents.inbox.help.description")}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {KEYS.filter((k) => canWrite || !k.write).map((k) => (
              <div key={k.keys} className="contents">
                <dt>
                  <kbd className="rounded border px-1 font-mono text-xs">{k.keys}</kbd>
                </dt>
                <dd>{t(k.label)}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InboxPane({
  row,
  canWrite,
  canMake,
  canFile,
  canLink,
  busy,
  openSearchKey,
  applyRequest,
  onOcr,
  onMake,
  onFile,
  onArchive,
  onRestore,
  onLinked,
}: {
  row: InboxItem;
  canWrite: boolean;
  canMake: boolean;
  canFile: boolean;
  canLink: boolean;
  busy: boolean;
  openSearchKey: number;
  applyRequest?: { index: number; requireHigh: boolean; seq: number; needsHighMessage?: string };
  onOcr: () => void;
  onMake: (d: "expense" | "supplier") => void;
  onFile: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onLinked: () => void;
}) {
  const t = useT();
  // F106: the bytes come from the authenticated route — a pure path from the id, nothing to fetch first
  const fileUrl = documentFileUrl(row.id);

  const f = row.facts;
  const facts: [MessageKey, ReactNode][] = [
    ["documents.inbox.fact.vendor", row.vendor],
    ["documents.inbox.fact.number", f.invoiceNumber],
    [
      "documents.inbox.fact.amount",
      row.amount ? (
        <span key="amount" className="tabular-nums" data-amount={row.amount}>
          {money(row.amount, row.currency)}
        </span>
      ) : null,
    ],
    [
      "documents.inbox.fact.date",
      row.documentDate ? (
        <span key="date" className="tabular-nums">
          {row.documentDate}
        </span>
      ) : null,
    ],
    [
      "documents.inbox.fact.quality",
      row.quality ? t(`documents.inbox.quality.${row.quality === "high" ? "high" : "low"}`) : null,
    ],
  ];
  const ocrable = ["needs_ocr", "stuck", "ocr_failed"].includes(row.state);

  return (
    <div className="flex flex-col gap-3" data-testid="inbox-pane">
      <div>
        <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          <CodeChip>
            <span data-testid="inbox-pane-key">{row.businessKey}</span>
          </CodeChip>
          <DocumentStateLabel state={row.state} />
        </h2>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Tag>{t(`documents.prefix.${row.prefixType}` as MessageKey)}</Tag>
          <span className="truncate" title={row.fileName}>
            {row.fileName}
          </span>
        </p>
        {row.state === "stuck" && (
          <p className="text-xs text-muted-foreground">{t("documents.inbox.stuck")}</p>
        )}
        {row.duplicateOf && (
          <p className="text-xs">
            <Link
              href={`/documents/${row.duplicateOf.id}`}
              className="text-primary hover:underline"
            >
              {t("documents.inbox.duplicateOf", { key: row.duplicateOf.businessKey })}
            </Link>
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2" data-testid="inbox-actions">
          {canWrite && ocrable && (
            <Button size="sm" disabled={busy} onClick={onOcr} data-testid="inbox-run-ocr">
              {t("documents.inbox.action.runOcr")}
            </Button>
          )}
          {canMake && (
            <>
              <Button
                size="sm"
                // one primary in the pane: *Run OCR* while the OCR is due, *Expense* once the facts are there
                variant={canWrite && ocrable ? "outline" : "default"}
                onClick={() => onMake("expense")}
                data-testid="inbox-make-expense"
              >
                {t("documents.makeIt.expense")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onMake("supplier")}
                data-testid="inbox-make-supplier-invoice"
              >
                {t("documents.makeIt.supplierInvoice")}
              </Button>
            </>
          )}
          {canFile && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onFile}
              title={t("documents.makeIt.justFileHint")}
              data-testid="inbox-file"
            >
              {t("documents.makeIt.justFile")}
            </Button>
          )}
          {canWrite && row.state !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onArchive}
              data-testid="inbox-archive"
            >
              {t("documents.inbox.action.archive")}
            </Button>
          )}
          {canWrite && row.state === "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onRestore}
              data-testid="inbox-restore"
            >
              {t("documents.inbox.action.restore")}
            </Button>
          )}
          <Button
            size="sm"
            variant="link"
            nativeButton={false}
            render={<Link href={`/documents/${row.id}`} />}
            data-testid="inbox-open"
          >
            {t("documents.inbox.action.open")}
          </Button>
        </div>
      </div>

      <DetailsSection title={t("documents.review.financial")}>
        <div data-testid="inbox-facts">
          <DetailsGrid rows={facts.filter(([, v]) => v).map(([label, v]) => [t(label), v])} />
        </div>
      </DetailsSection>

      {canLink && (
        <SuggestionsSection
          target={{ endpoint: { type: "document", id: row.id } }}
          canWrite={canWrite}
          onLinked={onLinked}
          openSearchKey={openSearchKey}
          applyRequest={applyRequest}
          limit={3}
        />
      )}

      <DetailsSection title={t("documents.preview.label")}>
        <div className="overflow-hidden rounded-lg border bg-background" style={{ height: "60vh" }}>
          <DocumentPreview fileUrl={fileUrl} mimeType={row.mimeType} />
        </div>
      </DetailsSection>
    </div>
  );
}

/** Whether a state counts as pending (for the tests and the page meta). */
export function isPendingState(s: InboxState): boolean {
  return PENDING.includes(s);
}
