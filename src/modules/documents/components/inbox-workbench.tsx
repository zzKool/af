"use client";

// The documents desk (specs/documents US4, D32, D34; F185 the board *Documents*): *Drop anything here* on top
// (the files in flight as tiles), then three columns — the **Inbox** (a card per document: its page, who, its kind,
// the amount, one line of what it needs; a left edge by state: the open one blue, done green, a duplicate red; the
// duplicate question at the bottom), **the document** with its boxes and **What it read** with *When you accept*
// (`inbox-pane.tsx`). Keyboard first: ↑ / ↓ move, Enter accepts. The tabs and the search sit behind the inbox's
// tools button. Archive and restore go on an undo stack that lives as long as the page. The accountant reads.
import { SlidersHorizontal } from "lucide-react";
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
import { useT } from "@/kernel/i18n/use-t";
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
import { sureCount } from "@/modules/documents/reading-marks";
import { NewExpensePanel } from "@/modules/expenses/ui";
import { NewSupplierInvoiceDialog } from "@/modules/supplier-invoices/ui";
import { BoardTag } from "./board-tag";
import { DocumentStateLabel } from "./document-state-label";
import { DropHero } from "./drop-hero";
import { type Accepted, InboxPane, kindWord, money } from "./inbox-pane";
import { initialFromFacts, type MakeItOptions } from "./make-it-section";
import { INBOX_KEYS, useInboxKeys } from "./use-inbox-keys";
import { useInboxUndo } from "./use-inbox-undo";

const TABS: readonly InboxTab[] = ["all", "pending", "ready", "duplicates", "archived"];
const PENDING: readonly InboxState[] = ["needs_ocr", "processing", "stuck", "ocr_failed"];
/** in flight: the hero's tiles show them, the page reads the inbox again until they are read */
const IN_FLIGHT: readonly InboxState[] = ["needs_ocr", "processing", "stuck"];
const POLL_MS = 3000;

/** A card's one line (the board): what the document needs — or what became of it. */
function cardNote(r: InboxItem, t: ReturnType<typeof useT>): { text: string; attention: boolean } {
  if (r.duplicateOf)
    return {
      text: t("documents.inbox.sameFileAs", { key: r.duplicateOf.businessKey }),
      attention: true,
    };
  if (r.state === "stuck") return { text: t("documents.inbox.stuck"), attention: true };
  if (r.state === "ocr_failed") return { text: t("documents.card.failed"), attention: true };
  if (r.state === "needs_ocr") return { text: t("documents.flight.queued"), attention: false };
  if (r.state === "processing") return { text: t("documents.flight.reading"), attention: false };
  if (r.state === "archived") return { text: t("documents.card.archived"), attention: false };
  const marks = r.reading?.marks ?? [];
  if (marks.length === 0) return { text: t("documents.card.nothingRead"), attention: true };
  const { check } = sureCount(marks, r.corrected ?? []);
  return check > 0
    ? { text: t("documents.card.toCheck", { count: check }), attention: true }
    : { text: t("documents.card.allSure"), attention: false };
}

/** A paper page in miniature — the board's thumbnail */
function Thumb() {
  return (
    <div
      className="flex h-11 w-[34px] shrink-0 flex-col gap-[3px] rounded-[4px] bg-paper p-[5px]"
      aria-hidden
    >
      <i className="block h-0.5 w-[70%] rounded-full bg-paper-line brightness-75" />
      <i className="block h-0.5 rounded-full bg-paper-line" />
      <i className="block h-0.5 w-[80%] rounded-full bg-paper-line" />
      <i className="block h-0.5 rounded-full bg-paper-line" />
      <i className="block h-0.5 w-[55%] rounded-full bg-paper-line" />
    </div>
  );
}

/** what the page made of a document this visit — it stays as a done card until the page is left */
type DoneCard = { row: InboxItem; note: string };

export { isTyping } from "./use-inbox-keys";
export { INBOX_UNDO_MAX } from "./use-inbox-undo";

export function InboxWorkbench({
  initial,
  canWrite,
  options,
  canUpload = false,
  total,
}: {
  initial: InboxData;
  canWrite: boolean;
  /** the two creation dialogs' option lists (owner only) */
  options: MakeItOptions | null;
  /** the owner drops files on the hero */
  canUpload?: boolean;
  /** every document, for *All documents (n)* */
  total?: number;
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [acceptRequest, setAcceptRequest] = useState(0);
  const [done, setDone] = useState<DoneCard[]>([]);
  const [keptBoth, setKeptBoth] = useState<Set<string>>(new Set());

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

  // files in flight: read the inbox again until they are read (the hero's tiles turn into cards)
  const inFlight = data.rows.some((r) => IN_FLIGHT.includes(r.state));
  useEffect(() => {
    if (!inFlight) return;
    const h = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(h);
  }, [inFlight, reload]);

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

  /** the chain was accepted (F185): the card stays as done for this visit, the inbox reloads */
  const accepted = useCallback(
    (a: Accepted) => {
      const r = rows.find((x) => x.id === a.id);
      if (r)
        setDone((list) => [
          {
            row: r,
            note: a.bankRowDate
              ? t("documents.card.becameLinked", { key: a.key, date: a.bankRowDate })
              : t("documents.card.became", { key: a.key }),
          },
          ...list.filter((d) => d.row.id !== a.id),
        ]);
      void reload();
    },
    [rows, reload, t],
  );

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
    accept: () => setAcceptRequest((n) => n + 1),
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
  // F180: the new expense form docked beside the open document (the queue folds away meanwhile)
  const expenseDocked = dialog === "expense" && !!options && !!makeInitial && !!open;
  const counts = data.counts;
  const countOf: Record<InboxTab, number> = {
    all: counts.total,
    pending: counts.pending,
    ready: counts.ready,
    duplicates: counts.duplicates,
    archived: counts.archived,
  };
  const lastUndo = undo.last;

  const pendingRows = rows.filter((r) => IN_FLIGHT.includes(r.state));
  const knownIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const needsLook = rows.filter((r) => cardNote(r, t).attention).length;
  const doneCards = done.filter((d) => !rows.some((r) => r.id === d.row.id));
  const dupBanner = rows.find((r) => r.duplicateOf && !keptBoth.has(r.id)) ?? null;
  const showTools = toolsOpen || tab !== "all" || q !== "";

  return (
    <div className="flex flex-col gap-4" data-testid="document-inbox">
      <DropHero
        pending={pendingRows}
        knownIds={knownIds}
        onUploaded={() => void reload()}
        canUpload={canUpload}
      />

      {/* the bulk bar and the undo bar */}
      {canWrite && (checked.size > 0 || lastUndo) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface px-3 py-1.5 text-sm"
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

      {/* F185, the board *Documents*: the inbox, the document, what it read. F180: the new expense form docks beside
          them (as on /expenses); while it is open the inbox folds away */}
      <div
        className={cn(
          "grid items-stretch gap-4",
          expenseDocked
            ? "xl:grid-cols-[minmax(0,1fr)_minmax(21rem,360px)]"
            : "xl:grid-cols-[280px_minmax(0,1fr)_360px]",
        )}
        data-expense-docked={expenseDocked ? "" : undefined}
      >
        {/* left: the inbox — D76: a card on the ground */}
        <section
          hidden={expenseDocked}
          className="flex min-h-[420px] min-w-0 flex-col gap-2 pulse-card p-3.5"
          aria-label={t("documents.inbox.title")}
        >
          <div className="flex items-center gap-2 px-1 pt-0.5 pb-1.5">
            <h2 className="text-[13px] font-semibold">{t("documents.inbox.heading")}</h2>
            <span
              className="min-w-0 truncate text-muted-foreground"
              data-public
              data-testid="inbox-meta"
            >
              {needsLook > 0
                ? t("documents.inbox.metaLook", { count: counts.total, look: needsLook })
                : String(counts.total)}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setToolsOpen((o) => !o)}
              aria-expanded={showTools}
              aria-label={t("documents.inbox.tools")}
              title={t("documents.inbox.tools")}
              data-testid="inbox-tools"
            >
              <SlidersHorizontal aria-hidden />
            </Button>
          </div>
          <div
            hidden={!showTools}
            className="flex flex-col gap-2 px-1 pb-1"
            data-testid="inbox-toolbar"
          >
            <Input
              className="h-8 rounded-lg bg-surface-2"
              placeholder={t("documents.inbox.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t("documents.inbox.search")}
              data-testid="inbox-search"
            />
            <div className="flex flex-wrap gap-1" role="tablist">
              {TABS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => switchTab(k)}
                  data-testid={`inbox-tab-${k}`}
                  className={cn(
                    "h-6 rounded-full px-2 text-[11.5px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    tab === k
                      ? "bg-selection font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-hover hover:text-foreground",
                  )}
                >
                  {t(`documents.inbox.tab.${k}`, { count: countOf[k] })}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <a
                href="/documents/library"
                className="text-primary hover:underline"
                data-testid="documents-library-link"
              >
                {t("documents.desk.all", { count: total ?? counts.total })}
              </a>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setHelpOpen(true)}
              >
                {t("documents.inbox.help.title")} <kbd className="font-mono">?</kbd>
              </button>
            </div>
          </div>

          <div className="relative min-h-[240px] flex-1">
            <div className="absolute inset-0 overflow-auto">
              {rows.length === 0 && doneCards.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground" data-testid="inbox-empty">
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
                <ul ref={listRef} className="flex flex-col gap-2 p-px">
                  {rows.map((r) => {
                    const active = r.id === openId;
                    const note = cardNote(r, t);
                    const kind = kindWord(r);
                    return (
                      <li
                        key={r.id}
                        data-row-id={r.id}
                        data-testid="inbox-row"
                        data-state={active ? "selected" : undefined}
                        data-inbox-state={r.state}
                        className={cn(
                          "group/card relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl border p-2.5",
                          active
                            ? "border-primary/45 bg-selection shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_10%,transparent)]"
                            : "border-subtle bg-surface-2 hover:bg-hover",
                        )}
                        onClick={() => {
                          paneClosed.current = false;
                          setOpenId(r.id);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}
                      >
                        {(active || r.duplicateOf) && (
                          <span
                            className={cn(
                              "absolute inset-y-0 left-0 w-[3px]",
                              r.duplicateOf && !active ? "bg-destructive" : "bg-primary",
                            )}
                            aria-hidden
                          />
                        )}
                        <Thumb />
                        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <div className="truncate font-semibold" title={r.fileName}>
                            {r.vendor ?? r.fileName}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5">
                            {r.duplicateOf ? (
                              <BoardTag tone="danger">{t("documents.card.duplicate")}</BoardTag>
                            ) : (
                              <BoardTag tone={kind.tone}>{t(kind.key)}</BoardTag>
                            )}
                            {r.amount && (
                              <span className="truncate font-mono text-[11.5px] text-muted-foreground tabular-nums">
                                {money(r.amount, r.currency)}
                              </span>
                            )}
                          </div>
                          <div
                            className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground"
                            data-testid={r.duplicateOf ? "inbox-dup" : "inbox-note"}
                          >
                            {r.state !== "ready" ? (
                              <DocumentStateLabel state={r.state} testId="inbox-state" />
                            ) : null}
                            <span className="truncate">{note.text}</span>
                          </div>
                        </div>
                        {canWrite && (
                          <Checkbox
                            className={cn(
                              "absolute top-2 right-2",
                              checked.size === 0 &&
                                "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100",
                            )}
                            checked={checked.has(r.id)}
                            onCheckedChange={(v) => toggle(r.id, v === true)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`${t("documents.inbox.select")} ${r.businessKey}`}
                            data-testid="inbox-row-check"
                          />
                        )}
                      </li>
                    );
                  })}
                  {doneCards.map((d) => {
                    const kind = kindWord(d.row);
                    return (
                      <li
                        key={d.row.id}
                        className="relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-subtle bg-surface-2 p-2.5"
                        data-testid="inbox-done"
                      >
                        <span
                          className="absolute inset-y-0 left-0 w-[3px] bg-state-done"
                          aria-hidden
                        />
                        <Thumb />
                        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <div className="truncate font-semibold">
                            {d.row.vendor ?? d.row.fileName}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <BoardTag tone={kind.tone}>{t(kind.key)}</BoardTag>
                            {d.row.amount && (
                              <span className="truncate font-mono text-[11.5px] text-muted-foreground tabular-nums">
                                {money(d.row.amount, d.row.currency)}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {d.note}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* the duplicate question (the board): the same file twice — discard (archive, undoable) or keep both */}
          {dupBanner?.duplicateOf && (
            <div
              className="rounded-xl border border-destructive/25 bg-destructive/6 p-3 text-xs text-destructive"
              data-testid="inbox-dup-banner"
            >
              <b>{t("documents.card.duplicate")}</b>{" "}
              {t("documents.inbox.dupBanner", {
                file: dupBanner.fileName,
                key: dupBanner.duplicateOf.businessKey,
              })}
              {canWrite && (
                <div className="mt-2 flex gap-1.5">
                  <Button
                    size="xs"
                    className="h-7 rounded-lg px-2.5"
                    disabled={archiving}
                    onClick={() => void park("archive", [dupBanner.id])}
                    data-testid="inbox-dup-discard"
                  >
                    {t("documents.inbox.dupDiscard")}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-7 rounded-lg px-2.5"
                    onClick={() => setKeptBoth((s) => new Set(s).add(dupBanner.id))}
                    data-testid="inbox-dup-keep"
                  >
                    {t("documents.inbox.dupKeep")}
                  </Button>
                </div>
              )}
            </div>
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
            acceptRequest={acceptRequest}
            onOcr={() => void ocr(open)}
            onMake={(d) => setDialog(d)}
            onFile={() => void justFile(open)}
            onArchive={() => void park("archive", [open.id])}
            onRestore={() => void park("restore", [open.id])}
            onLinked={() => void reload()}
            onAccepted={accepted}
          />
        ) : (
          <section className="pulse-card p-5 xl:col-span-2" aria-label={t("documents.inbox.pane")}>
            <p className="text-sm text-muted-foreground">{t("documents.inbox.selectDocument")}</p>
          </section>
        )}
      </div>

      {/* Make it… — the modules' own forms, pre-filled from the open document: the expense docked (F180), the
          supplier invoice a dialog */}
      {options && makeInitial && open && (
        <>
          <NewExpensePanel
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
