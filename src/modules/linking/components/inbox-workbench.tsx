"use client";

// The inbox (specs/linking/spec.md US3, harvest H7): the rows needing attention on the left — best candidate
// first — the selected row in full on the right, the keyboard the owner drives it with, *Apply HIGH* on the
// selection with its applied / skipped report, and the unlinked documents on a second tab. A candidate that is an
// expense or a supplier invoice opens its panel instead (D37, F58); *Apply HIGH* reports it as not applied.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { TransactionDetailView } from "@/modules/banking/ui";
import type { CategoryOption, PartnerOption } from "@/modules/journal/ui";
import type { InboxRow } from "@/modules/linking/inbox";
import {
  applySuggestionAction,
  bulkApplyHighAction,
  removeLinkAction,
} from "@/modules/linking/linking.actions";
import type { BulkApplyResult, EntityFacts, Suggestion } from "@/modules/linking/types";
import { attachHref } from "../hrefs";
import { needsOwnFlow } from "../kinds";
import { CONFIDENCE_STYLE, SuggestionsSection, useReasonLabel } from "./suggestions-section";

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

type Tab = "rows" | "documents";

const KEYS: [string, string][] = [
  ["j / ↓ · k / ↑", "linking.inbox.help.move"],
  ["Enter", "linking.inbox.help.enter"],
  ["1 – 9", "linking.inbox.help.nth"],
  ["l", "linking.inbox.help.linkTo"],
  ["c", "linking.inbox.help.categorise"],
  ["u", "linking.inbox.help.undo"],
  ["?", "linking.inbox.help.help"],
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    !!el.closest("[role=dialog]") ||
    !!el.closest("[role=listbox]")
  );
}

export function InboxWorkbench({
  rows,
  documents,
  categories,
  partners,
  canWrite,
}: {
  rows: InboxRow[];
  documents: EntityFacts[];
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const reasonLabel = useReasonLabel();
  const [tab, setTab] = useState<Tab>("rows");
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.row.id ?? null);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(documents[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openSearchKey, setOpenSearchKey] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [report, setReport] = useState<BulkApplyResult | null>(null);
  const undo = useRef<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const { executeAsync: apply, isPending: applying } = useAction(applySuggestionAction);
  const { executeAsync: bulk, isPending: bulking } = useAction(bulkApplyHighAction);
  const { executeAsync: remove } = useAction(removeLinkAction);

  // the list shrinks as rows get linked — keep a valid selection
  useEffect(() => {
    if (tab !== "rows") return;
    if (selectedId && rows.some((r) => r.row.id === selectedId)) return;
    setSelectedId(rows[0]?.row.id ?? null);
  }, [rows, selectedId, tab]);
  useEffect(() => {
    if (selectedDoc && documents.some((d) => d.id === selectedDoc)) return;
    setSelectedDoc(documents[0]?.id ?? null);
  }, [documents, selectedDoc]);

  const index = rows.findIndex((r) => r.row.id === selectedId);
  const selected = index >= 0 ? rows[index] : null;
  const highCount = rows.filter((r) => r.top?.confidence === "HIGH").length;
  const labels = useMemo(() => new Map(rows.map((r) => [r.row.id, r.row.label])), [rows]);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const next = Math.min(rows.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
      const id = rows[next]?.row.id ?? null;
      setSelectedId(id);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    [rows, index],
  );

  const applyOne = useCallback(
    async (row: InboxRow, s: Suggestion) => {
      if (!canWrite) return;
      // an expense / supplier invoice writes its own payment (D37, F58): its panel, the row preselected
      if (needsOwnFlow("justifies", s.candidate.type)) {
        router.push(attachHref({ type: s.candidate.type, id: s.candidate.id }, row.row.id));
        return;
      }
      if (s.allocation === null) {
        toast.error(t("linking.crossCurrencyHint"));
        return;
      }
      const r = await apply({
        bankTransactionId: row.row.id,
        to: { type: s.candidate.type, id: s.candidate.id },
        allocatedAmount: s.allocation,
      });
      const error = extractError(r);
      if (error) return toast.error(error);
      const link = r?.data && "data" in r.data ? r.data.data : undefined;
      if (link) undo.current.push(link.id);
      toast.success(t("linking.linked", { label: s.candidate.label }));
      move(1);
      router.refresh();
    },
    [apply, canWrite, move, router, t],
  );

  const undoLast = useCallback(async () => {
    const id = undo.current.pop();
    if (!id) {
      toast.message(t("linking.inbox.nothingToUndo"));
      return;
    }
    const r = await remove({ id });
    const error = extractError(r);
    if (error) return toast.error(error);
    toast.success(t("linking.unlinked"));
    router.refresh();
  }, [remove, router, t]);

  // the keyboard (harvest §5): ignored while typing or inside a dialog
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tab !== "rows" || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      if (helpOpen) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Enter" && selected) {
        e.preventDefault();
        if (selected.top?.confidence === "HIGH") void applyOne(selected, selected.top);
        else toast.message(t("linking.inbox.enterNeedsHigh"));
      } else if (/^[1-9]$/.test(e.key) && selected) {
        e.preventDefault();
        const s = selected.suggestions[Number(e.key) - 1];
        if (s) void applyOne(selected, s);
      } else if (e.key === "l" && selected) {
        e.preventDefault();
        setOpenSearchKey((k) => k + 1);
      } else if (e.key === "c") {
        e.preventDefault();
        document
          .querySelector<HTMLElement>('[data-testid="categorise-form"] [role="combobox"]')
          ?.focus();
      } else if (e.key === "u") {
        e.preventDefault();
        void undoLast();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, helpOpen, move, selected, applyOne, undoLast, t]);

  async function applyHigh() {
    const ids = checked.size > 0 ? [...checked] : rows.map((r) => r.row.id);
    if (ids.length === 0) return;
    const r = await bulk({ bankTransactionIds: ids.slice(0, 200) });
    const error = extractError(r);
    if (error) return toast.error(error);
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return;
    setReport(d);
    setChecked(new Set());
    router.refresh();
  }

  function toggle(id: string, on: boolean) {
    setChecked((c) => {
      const next = new Set(c);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const doc = documents.find((d) => d.id === selectedDoc) ?? null;

  return (
    <div className="flex flex-col gap-3" data-testid="inbox">
      {/* tabs + bulk bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={tab === "rows" ? "default" : "outline"}
            onClick={() => setTab("rows")}
            data-testid="inbox-tab-rows"
          >
            {t("linking.inbox.tab.rows", { count: rows.length })}
          </Button>
          <Button
            size="sm"
            variant={tab === "documents" ? "default" : "outline"}
            onClick={() => setTab("documents")}
            data-testid="inbox-tab-documents"
          >
            {t("linking.inbox.tab.documents", { count: documents.length })}
          </Button>
        </div>
        {tab === "rows" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("linking.inbox.highCount", { count: highCount })}
            </span>
            {canWrite && (
              <Button
                size="sm"
                disabled={bulking || highCount === 0}
                onClick={() => void applyHigh()}
                title={highCount === 0 ? t("linking.inbox.noHigh") : undefined}
                data-testid="apply-high"
              >
                {checked.size > 0
                  ? t("linking.inbox.applyHighSelected", { count: checked.size })
                  : t("linking.inbox.applyHigh")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)} aria-label="?">
              ?
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* left: the list */}
        <section className="min-w-0 rounded-md border" aria-label="Inbox list">
          {tab === "rows" ? (
            rows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t("linking.inbox.empty")}</p>
            ) : (
              <ul ref={listRef} className="max-h-[75vh] divide-y overflow-auto text-sm">
                {rows.map((r) => {
                  const active = r.row.id === selectedId;
                  return (
                    <li
                      key={r.row.id}
                      data-row-id={r.row.id}
                      data-testid="inbox-row"
                      data-state={active ? "selected" : undefined}
                      className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${active ? "bg-muted" : "hover:bg-muted/50"}`}
                      onClick={() => setSelectedId(r.row.id)}
                      onKeyDown={(e) => e.key === "Enter" && setSelectedId(r.row.id)}
                    >
                      {canWrite && (
                        <Checkbox
                          className="mt-1"
                          checked={checked.has(r.row.id)}
                          onCheckedChange={(v) => toggle(r.row.id, v === true)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`${t("linking.inbox.select")} ${r.row.label || r.row.date}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums">{r.row.date}</span>
                          <span
                            className={`tabular-nums ${r.row.direction === "incoming" ? "text-green-700 dark:text-green-400" : ""}`}
                          >
                            {r.row.direction === "incoming" ? "+" : "−"}
                            {money(r.row.amount, r.row.currency)}
                          </span>
                          {r.state === "partial" && (
                            <Badge variant="outline">{t("banking.state.partial")}</Badge>
                          )}
                        </div>
                        <div className="truncate text-muted-foreground" title={r.row.texts[5]}>
                          {r.row.texts[5]} · {r.accountLabel}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          {r.top ? (
                            <>
                              <Badge
                                variant="outline"
                                className={CONFIDENCE_STYLE[r.top.confidence]}
                                data-testid="inbox-top-confidence"
                              >
                                {t(`linking.confidence.${r.top.confidence}`)}
                              </Badge>
                              <span className="truncate" title={r.top.candidate.label}>
                                {r.top.candidate.label}
                              </span>
                              {r.top.confidence === "HIGH" && (
                                <kbd className="ml-auto rounded border px-1 text-[10px] text-muted-foreground">
                                  Enter
                                </kbd>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("linking.inbox.noCandidate")}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : documents.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("linking.inbox.noDocuments")}</p>
          ) : (
            <ul className="max-h-[75vh] divide-y overflow-auto text-sm">
              {documents.map((d) => (
                <li
                  key={d.id}
                  data-testid="inbox-document"
                  className={`cursor-pointer px-3 py-2 ${d.id === selectedDoc ? "bg-muted" : "hover:bg-muted/50"}`}
                  onClick={() => setSelectedDoc(d.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedDoc(d.id)}
                >
                  <div className="truncate" title={d.label}>
                    {d.label}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">{d.date}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* right: the detail */}
        <section className="min-w-0" aria-label="Inbox detail">
          {tab === "rows" ? (
            selected ? (
              <TransactionDetailView
                key={selected.row.id}
                transactionId={selected.row.id}
                categories={categories}
                partners={partners}
                canWrite={canWrite}
                onChanged={() => router.refresh()}
                openSearchKey={openSearchKey}
                header={(title, description) => (
                  <div>
                    <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                      {title}
                    </h2>
                    <p className="text-sm text-muted-foreground">{description}</p>
                    {selected.suggestions.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selected.suggestions
                          .slice(0, 3)
                          .map(
                            (s, i) =>
                              `${i + 1}. ${s.candidate.label} (${s.reasons.map(reasonLabel)[0] ?? ""})`,
                          )
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                )}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("linking.inbox.selectRow")}</p>
            )
          ) : doc ? (
            <div className="flex flex-col gap-4" data-testid="inbox-document-detail">
              <div>
                <h2 className="text-base font-semibold">{doc.label}</h2>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {doc.date}
                  {Number(doc.amount) > 0 ? ` · ${money(doc.amount, doc.currency)}` : ""}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  nativeButton={false}
                  render={<Link href={`/documents/${doc.id}`} />}
                >
                  {t("linking.inbox.openDocument")}
                </Button>
              </div>
              <SuggestionsSection
                key={doc.id}
                target={{ endpoint: { type: "document", id: doc.id } }}
                canWrite={canWrite}
                onLinked={() => router.refresh()}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("linking.inbox.selectDocument")}</p>
          )}
        </section>
      </div>

      {/* the keyboard help */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent data-testid="inbox-help">
          <DialogHeader>
            <DialogTitle>{t("linking.inbox.help.title")}</DialogTitle>
            <DialogDescription>{t("linking.inbox.help.description")}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {KEYS.map(([key, label]) => (
              <div key={key} className="contents">
                <dt>
                  <kbd className="rounded border px-1 font-mono text-xs">{key}</kbd>
                </dt>
                <dd>{t(label as Parameters<typeof t>[0])}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      {/* the bulk report */}
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent data-testid="apply-high-report">
          <DialogHeader>
            <DialogTitle>{t("linking.inbox.report.title")}</DialogTitle>
            <DialogDescription>
              {report &&
                t("linking.inbox.report.summary", {
                  applied: report.applied.length,
                  skipped: report.skipped.length,
                  failed: report.failed.length,
                })}
            </DialogDescription>
          </DialogHeader>
          {report && (report.skipped.length > 0 || report.failed.length > 0) && (
            <ul className="max-h-64 divide-y overflow-auto rounded-md border text-sm">
              {report.skipped.map((s) => (
                <li key={`${s.bankTransactionId}-${s.reason}`} className="px-3 py-1.5">
                  <span className="truncate">
                    {labels.get(s.bankTransactionId) ?? s.bankTransactionId}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    {t(`linking.inbox.skip.${s.reason}`)} — {s.detail}
                  </div>
                </li>
              ))}
              {report.failed.map((f) => (
                <li
                  key={f.bankTransactionId}
                  className="px-3 py-1.5 text-red-700 dark:text-red-300"
                >
                  {labels.get(f.bankTransactionId) ?? f.bankTransactionId}: {f.message}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
