"use client";

// The open document of the inbox (F153, the board *Documents*): its preview, what it is, what the reading found, its
// facts, the bank rows that could justify it and the actions its state allows — the second and third columns of
// `inbox-workbench.tsx`, which owns the list, the keys and the dialogs. Split out of the workbench (F67, lessons
// *Components over 400 lines*) — same DOM.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import { classifyDocumentAction } from "@/modules/documents/documents.actions";
import { documentFileUrl } from "@/modules/documents/file";
import { ASK_KINDS, readingProposes } from "@/modules/documents/proposes";
import type { InboxFacts, InboxItem } from "@/modules/documents/queries";
import { type MarkedKey, sureCount } from "@/modules/documents/reading-marks";
import { SuggestionsSection } from "@/modules/linking/ui";
import { DocumentStateLabel } from "./document-state-label";
import { FieldConfidence } from "./field-confidence";

const DocumentPreview = dynamic(() => import("@/modules/documents/components/document-preview"), {
  ssr: false,
  loading: () => <div className="aspect-[3/4] animate-pulse rounded-lg bg-muted" />,
});

/** On-screen money (D40); an OCR amount the formatter refuses shows as it came rather than breaking the pane. */
export function money(amount: string, currency: string | null): string {
  try {
    return formatMoney(amount, currency);
  } catch {
    return currency ? `${amount} ${currency}` : amount;
  }
}

/** A mark's value as the inbox facts hold it (as corrected), for the list. */
function markValue(row: InboxItem, key: MarkedKey): string {
  const v = row.facts[key as keyof InboxFacts];
  if (v === undefined || v === null) return "";
  if (key === "invoiceTotal" || key === "subtotal" || key === "totalTax")
    return formatMoney(String(v), row.facts.currency ?? null);
  return String(v);
}

/**
 * F141, the board *Documents*: what the reading found — each field, its value, DI's confidence — *N sure · M to
 * check*; hovering a line lights its box on the preview.
 */
function WhatItRead({
  row,
  active,
  onActive,
}: {
  row: InboxItem;
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const t = useT();
  const marks = row.reading?.marks ?? [];
  const { sure, check } = sureCount(marks);
  return (
    <section className="flex flex-col gap-1.5" data-testid="inbox-what-it-read">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold">
        {t("documents.read.title")}
        <span className="text-xs font-normal text-muted-foreground">
          {t("documents.read.count", { sure, check })}
        </span>
      </h3>
      <ul className="flex flex-col">
        {marks.map((m) => (
          <li key={m.key}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-hover",
                active === m.key && "bg-surface-2",
              )}
              onMouseEnter={() => onActive(m.key)}
              onMouseLeave={() => onActive(null)}
              onFocus={() => onActive(m.key)}
              onBlur={() => onActive(null)}
              data-mark={m.key}
            >
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                {t(`documents.read.field.${m.key}` as MessageKey)}
              </span>
              <span className="min-w-0 flex-1 truncate tabular-nums">{markValue(row, m.key)}</span>
              <FieldConfidence confidence={m.confidence} />
            </button>
            {typeof m.confidence === "number" && (
              <div
                className="mx-2 mb-1 h-0.5 overflow-hidden rounded-full bg-surface-2"
                aria-hidden
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    m.confidence >= 0.9 ? "bg-state-done/60" : "bg-state-attention/70",
                  )}
                  style={{ width: `${Math.round(m.confidence * 100)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** D78: no amount read on a drop nobody typed — one question, the answer types it (the key and the model follow). */
function WhatIsIt({
  documentId,
  canWrite,
  onTyped,
}: {
  documentId: string;
  canWrite: boolean;
  onTyped: () => void;
}) {
  const t = useT();
  const { executeAsync, isPending } = useAction(classifyDocumentAction);
  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded-xl border border-state-attention/30 bg-state-attention/6 p-3"
      data-testid="inbox-what-is-it"
    >
      <p className="text-sm font-medium">{t("documents.inbox.whatIsIt")}</p>
      {canWrite && (
        <div className="flex flex-wrap gap-1.5">
          {ASK_KINDS.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              disabled={isPending}
              data-kind={kind}
              onClick={async () => {
                const r = await executeAsync({ documentId, documentType: kind });
                const error = extractError(r);
                if (error) return void toast.error(error);
                toast.success(
                  t("documents.inbox.typed", {
                    type: t(`documents.prefix.${kind}` as MessageKey),
                  }),
                );
                onTyped();
              }}
            >
              {t(`documents.prefix.${kind}` as MessageKey)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function InboxPane({
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
  // F141: the field *What it read* hovers — its box stands out on the preview
  const [activeMark, setActiveMark] = useState<string | null>(null);

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
  // D78: a drop nobody typed — the reading proposes what it becomes; no amount read, the pane asks what it is
  const untyped = row.prefixType === "document" && row.state === "ready";
  const proposal = untyped ? readingProposes(row.facts) : null;
  const ask = proposal === "ask";
  const supplierFirst = proposal === "supplier_invoice";

  return (
    <>
      {/* the document, its boxes lit by what it read (F141) */}
      <section
        className="min-w-0 pulse-card p-4"
        aria-label={row.fileName}
        data-testid="inbox-preview-card"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Tag>{t(`documents.prefix.${row.prefixType}` as MessageKey)}</Tag>
          <span className="min-w-0 truncate" title={row.fileName}>
            {row.fileName}
          </span>
          {row.reading && row.reading.marks.length > 0 && (
            <span className="ml-auto hidden xl:inline">{t("documents.desk.previewHint")}</span>
          )}
        </div>
        <div
          className="overflow-hidden rounded-xl border border-subtle bg-surface-2"
          style={{ height: "72vh" }}
          data-testid="inbox-preview"
        >
          <DocumentPreview
            fileUrl={fileUrl}
            mimeType={row.mimeType}
            marks={row.reading}
            active={activeMark}
          />
        </div>
      </section>

      {/* what it is, what it read, what it could pay, and what to do with it */}
      <section
        className="flex min-w-0 flex-col gap-4 pulse-card p-5 xl:sticky xl:top-3"
        aria-label={t("documents.inbox.pane")}
        data-testid="inbox-pane"
      >
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            <CodeChip>
              <span data-testid="inbox-pane-key">{row.businessKey}</span>
            </CodeChip>
            <DocumentStateLabel state={row.state} />
          </h2>
          {row.vendor && <p className="mt-1 text-[15px] font-semibold">{row.vendor}</p>}
          {row.state === "stuck" && (
            <p className="text-xs text-muted-foreground">{t("documents.inbox.stuck")}</p>
          )}
          {row.duplicateOf && (
            <p className="mt-1 text-xs">
              <Link
                href={`/documents/${row.duplicateOf.id}`}
                className="text-primary hover:underline"
              >
                {t("documents.inbox.duplicateOf", { key: row.duplicateOf.businessKey })}
              </Link>
            </p>
          )}
          {proposal && proposal !== "ask" && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="inbox-proposes">
              {t(`documents.inbox.proposes.${proposal}`)}
            </p>
          )}
          {ask && <WhatIsIt documentId={row.id} canWrite={canWrite} onTyped={onLinked} />}
        </div>

        {row.reading && row.reading.marks.length > 0 && (
          <WhatItRead row={row} active={activeMark} onActive={setActiveMark} />
        )}

        {/* what it read says it already: the plain facts fold away then */}
        <DetailsSection
          title={t("documents.review.financial")}
          defaultOpen={!(row.reading && row.reading.marks.length > 0)}
        >
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

        <div
          className="flex flex-wrap gap-2 border-t border-subtle pt-3"
          data-testid="inbox-actions"
        >
          {canWrite && ocrable && (
            <Button size="sm" disabled={busy} onClick={onOcr} data-testid="inbox-run-ocr">
              {t("documents.inbox.action.runOcr")}
            </Button>
          )}
          {canMake && !ask && (
            <>
              <Button
                size="sm"
                // one primary in the pane: *Run OCR* while the OCR is due, then what the reading proposes (D78)
                variant={(canWrite && ocrable) || supplierFirst ? "outline" : "default"}
                onClick={() => onMake("expense")}
                data-testid="inbox-make-expense"
              >
                {t("documents.makeIt.expense")}
              </Button>
              <Button
                size="sm"
                variant={supplierFirst ? "default" : "outline"}
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
      </section>
    </>
  );
}
