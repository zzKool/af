"use client";

// The document inbox (specs/documents US4, D32, D34): every document that still needs a decision on the left —
// tabs with counts, search, selection — the open one on the right with its preview, facts, the bank rows that
// could justify it and the actions its state allows. Keyboard first, shaped like /banking/inbox. Archive and
// restore go on an undo stack that lives as long as the page. The accountant reads, nothing more.
import { FileText } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import {
  archiveDocumentsAction,
  listInboxAction,
  markDocumentReviewedAction,
  runOcrAction,
  unarchiveDocumentsAction,
} from "@/modules/documents/documents.actions";
import type { InboxState, InboxTab } from "@/modules/documents/inbox";
import type { InboxData, InboxItem } from "@/modules/documents/queries";
import { NewExpenseDialog } from "@/modules/expenses/ui";
import { NewSupplierInvoiceDialog } from "@/modules/supplier-invoices/ui";
import { DocumentStateLabel } from "./document-state-label";
import { InboxPane, money } from "./inbox-pane";
import { initialFromFacts, type MakeItOptions } from "./make-it-section";
import { INBOX_KEYS, useInboxKeys } from "./use-inbox-keys";
import { useInboxUndo } from "./use-inbox-undo";

const TABS: readonly InboxTab[] = ["all", "pending", "ready", "duplicates", "archived"];
const PENDING: readonly InboxState[] = ["needs_ocr", "processing", "stuck", "ocr_failed"];
/** the queue card's left edge (the board): what the document needs, at a glance — the state label says it in words */
const ROW_EDGE: Partial<Record<InboxState, string>> = {
  ready: "border-l-primary",
  needs_ocr: "border-l-state-progress",
  processing: "border-l-state-progress",
  stuck: "border-l-state-attention",
  ocr_failed: "border-l-destructive",
  archived: "border-l-border",
};

export { isTyping } from "./use-inbox-keys";
export { INBOX_UNDO_MAX } from "./use-inbox-undo";

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
  const undo = useInboxUndo();
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
        if (done.length > 0) undo.push({ kind, ids: done });
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
    [archive, unarchive, canWrite, reload, t, undo.push],
  );

  const undoLast = useCallback(async () => {
    const last = undo.pop();
    if (!last) {
      toast.message(t("documents.inbox.toast.nothingToUndo"));
      return;
    }
    await park(last.kind === "archive" ? "restore" : "archive", last.ids, true);
  }, [undo, park, t]);

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

  // the keyboard (FR-022): the map and its handler in `use-inbox-keys.ts`
  useInboxKeys({
    dialogOpen: dialog !== null,
    helpOpen,
    toggleHelp: () => setHelpOpen((o) => !o),
    canWrite,
    open,
    tab,
    selection,
    canMake,
    canLink,
    escape: () => {
      if (openId) {
        paneClosed.current = true;
        setOpenId(null);
      } else if (checked.size > 0) setChecked(new Set());
    },
    move,
    toggle: (id) => toggle(id),
    toggleAll: () =>
      setChecked((c) =>
        c.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((r) => r.id)),
      ),
    ocr: (row) => void ocr(row),
    make: (d) => setDialog(d),
    openSearch: () => setOpenSearchKey((k) => k + 1),
    park: (kind, ids) => void park(kind, ids),
    refresh: () => void reload().then(() => toast.message(t("documents.inbox.toast.refreshed"))),
    undo: () => void undoLast(),
    apply: (index, requireHigh) =>
      setApplyRequest((prev) => ({
        index,
        requireHigh,
        seq: (prev?.seq ?? 0) + 1,
        needsHighMessage: t("documents.inbox.enterNeedsHigh"),
      })),
  });

  const makeInitial = useMemo(
    () =>
      open
        ? initialFromFacts(
            open.id,
            open.businessKey,
            open.facts,
            options?.basProposals?.[open.id] ?? null,
          )
        : null,
    [open, options?.basProposals],
  );
  const counts = data.counts;
  const countOf: Record<InboxTab, number> = {
    all: counts.total,
    pending: counts.pending,
    ready: counts.ready,
    duplicates: counts.duplicates,
    archived: counts.archived,
  };
  const lastUndo = undo.last;

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

      {/* F153, the board *Documents*: three columns — what waits, the document, what it read */}
      <div className="grid items-start gap-[18px] xl:grid-cols-[19rem_minmax(0,1fr)_minmax(21rem,25rem)]">
        {/* left: the queue — D76: a card on the ground */}
        <section
          className="min-w-0 overflow-hidden pulse-card"
          aria-label={t("documents.inbox.title")}
        >
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
            <ul
              ref={listRef}
              className="flex max-h-[75vh] flex-col gap-2 overflow-auto p-2 text-sm"
            >
              {rows.map((r) => {
                const active = r.id === openId;
                return (
                  <li
                    key={r.id}
                    data-row-id={r.id}
                    data-testid="inbox-row"
                    data-state={active ? "selected" : undefined}
                    data-inbox-state={r.state}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-xl border border-l-[3px] border-subtle px-3 py-2.5",
                      r.duplicateOf
                        ? "border-l-destructive"
                        : (ROW_EDGE[r.state] ?? "border-l-border"),
                      active ? "border-primary/60 bg-selection" : "hover:bg-hover",
                    )}
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
                    <FileText
                      aria-hidden
                      className="mt-0.5 size-8 shrink-0 rounded-md bg-surface-2 p-1.5 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      {r.vendor && (
                        <div className="truncate text-[13.5px] font-semibold">{r.vendor}</div>
                      )}
                      <div className="flex items-center gap-2">
                        <CodeChip>{r.businessKey}</CodeChip>
                        <DocumentStateLabel state={r.state} testId="inbox-state" />
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <Tag>{t(`documents.prefix.${r.prefixType}` as MessageKey)}</Tag>
                        <span className="truncate" title={r.fileName}>
                          {r.fileName}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground tabular-nums">
                        {/* the amount and the date read; the upload day (yyyy-mm-dd, D40) when nothing was read */}
                        {[
                          r.amount ? money(r.amount, r.currency) : null,
                          r.documentDate ?? r.createdAt.slice(0, 10),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
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

        {/* the open document: its two cards fill the second and third column */}
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
          <section className="pulse-card p-5 xl:col-span-2" aria-label={t("documents.inbox.pane")}>
            <p className="text-sm text-muted-foreground">{t("documents.inbox.selectDocument")}</p>
          </section>
        )}
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
            {INBOX_KEYS.filter((k) => canWrite || !k.write).map((k) => (
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

/** Whether a state counts as pending (for the tests and the page meta). */
export function isPendingState(s: InboxState): boolean {
  return PENDING.includes(s);
}
