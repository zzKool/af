"use client";

// The open document of the desk (F185, the board *Documents*) — its second and third columns:
//   the document  a header line (its kind — *detected* when the reading said it —, its pages, how long the reading
//                 took, its key) and the page as paper with a box on every field read; the field active on the
//                 right stands out on the page
//   what it read  one row per field (`WhatItRead`): value, confidence, a bar in its band; a field to check opens in
//                 place with its question and one-click answers — an answer is a correction on the document — then
//                 *When you accept*: creates · links · files (`documentAcceptChain`) and the one primary that does
//                 them through the existing actions — `justifyRow` when a bank row pays it (one transaction), else
//                 the supplier invoice's create; a month's group is made first when none exists (as the reading
//                 dialog does). What the chain lacks opens the module's own form, pre-filled (*Make it…*).
// The workbench owns the list, the keys and the dialogs.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import {
  type AcceptChain,
  acceptLabelKey,
  chainSteps,
  expensePayload,
  supplierPayload,
} from "@/modules/documents/accept-chain-rules";
import {
  classifyDocumentAction,
  updateDocumentCorrectionsAction,
} from "@/modules/documents/documents.actions";
import { documentFileUrl } from "@/modules/documents/file";
import { ASK_KINDS, readingProposes } from "@/modules/documents/proposes";
import type { InboxFacts, InboxItem } from "@/modules/documents/queries";
import { isSure, type MarkedKey } from "@/modules/documents/reading-marks";
import { AMOUNT_KEYS, checkAsk, correctionFor, DATE_KEYS } from "@/modules/documents/to-check";
import { NEW_GROUP, useCreateGroupIfNew } from "@/modules/expenses/ui";
import {
  documentAcceptChainAction,
  justifyRowAction,
  SuggestionsSection,
} from "@/modules/linking/ui";
import { FromSubscriptionButtons, useSubscriptionMatches } from "@/modules/subscriptions/ui";
import { createSupplierInvoiceAction } from "@/modules/supplier-invoices/ui";
import { AcceptChainView, type ChainNode } from "./accept-chain-view";
import { BoardTag, kindTone } from "./board-tag";
import { DocumentStateLabel } from "./document-state-label";
import { type ReadField, WhatItRead } from "./read-fields";

const DocumentPreview = dynamic(() => import("@/modules/documents/components/document-preview"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-lg bg-surface-2" />,
});

/** On-screen money (D40); an OCR amount the formatter refuses shows as it came rather than breaking the pane. */
export function money(amount: string, currency: string | null, signed = false): string {
  try {
    return formatMoney(amount, currency, { signed });
  } catch {
    return currency ? `${amount} ${currency}` : amount;
  }
}

/** A field's value as the inbox facts hold it (as corrected): what the row shows, and what its edit starts from. */
function fieldValue(row: InboxItem, key: MarkedKey): { shown: string; raw: string } {
  const v = row.facts[key as keyof InboxFacts];
  if (v === undefined || v === null) return { shown: "", raw: "" };
  if (AMOUNT_KEYS.includes(key)) {
    const raw = Number(v).toFixed(2);
    return { shown: money(raw, row.facts.currency ?? null), raw };
  }
  return { shown: String(v), raw: String(v) };
}

/** What the document is, in the board's words: its kind, and whether the reading said it (a drop nobody typed). */
export function kindWord(row: Pick<InboxItem, "prefixType" | "facts">): {
  key: MessageKey;
  tone: ReturnType<typeof kindTone>;
  detected: boolean;
} {
  if (row.prefixType === "invoice")
    return { key: "documents.kind.supplierInvoice", tone: "progress", detected: false };
  if (row.prefixType === "expense")
    return { key: "documents.kind.receipt", tone: "attention", detected: false };
  if (row.prefixType === "document") {
    const p = readingProposes(row.facts);
    if (p === "supplier_invoice")
      return { key: "documents.kind.supplierInvoice", tone: "progress", detected: true };
    if (p === "expense")
      return { key: "documents.kind.receipt", tone: "attention", detected: true };
  }
  return {
    key: `documents.prefix.${row.prefixType}` as MessageKey,
    tone: kindTone(row.prefixType),
    detected: false,
  };
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
      className="flex flex-col gap-2 rounded-xl border border-state-attention/30 bg-state-attention/6 p-3"
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

export type Accepted = {
  id: string;
  key: string;
  kind: AcceptChain["kind"];
  bankRowDate: string | null;
};

export function InboxPane({
  row,
  canWrite,
  canMake,
  canFile,
  canLink,
  busy,
  openSearchKey,
  applyRequest,
  acceptRequest = 0,
  onOcr,
  onMake,
  onFile,
  onArchive,
  onRestore,
  onLinked,
  onAccepted,
}: {
  row: InboxItem;
  canWrite: boolean;
  canMake: boolean;
  canFile: boolean;
  canLink: boolean;
  busy: boolean;
  openSearchKey: number;
  applyRequest?: { index: number; requireHigh: boolean; seq: number; needsHighMessage?: string };
  /** Enter on the page (F185): a new value accepts the chain, or opens the form when the chain lacks something */
  acceptRequest?: number;
  onOcr: () => void;
  onMake: (d: "expense" | "supplier") => void;
  onFile: () => void;
  onArchive: () => void;
  onRestore: () => void;
  /** something changed on the document (a link, a type, a correction): the host reloads its list */
  onLinked: () => void;
  /** the chain was accepted: the host shows the card as done and reloads */
  onAccepted?: (done: Accepted) => void;
}) {
  const t = useT();
  const fileUrl = documentFileUrl(row.id);
  const marks = row.reading?.marks ?? [];
  const corrected = row.corrected ?? [];

  // the field active on the right — its box stands out on the page; the first one to check to begin with (the board)
  const [active, setActive] = useState<string | null>(
    () => marks.find((m) => !isSure(m, corrected))?.key ?? marks[0]?.key ?? null,
  );

  const fields: ReadField[] = useMemo(
    () =>
      marks.map((m) => {
        const v = fieldValue(row, m.key);
        return {
          key: m.key,
          label: t(`documents.read.field.${m.key}` as MessageKey),
          value: v.shown,
          raw: v.raw,
          input: DATE_KEYS.includes(m.key)
            ? "date"
            : AMOUNT_KEYS.includes(m.key)
              ? "amount"
              : "text",
          confidence: m.confidence,
          sure: isSure(m, corrected),
          corrected: corrected.includes(m.key),
          ask: checkAsk(m, row.facts, corrected),
        };
      }),
    [marks, row, corrected, t],
  );

  // an answer or an edit is a correction on the document (the review page's own write)
  const { executeAsync: correct, isPending: correcting } = useAction(
    updateDocumentCorrectionsAction,
  );
  async function answer(key: string, raw: string) {
    const patch = correctionFor(key as MarkedKey, raw);
    if (!patch) {
      toast.error(t("documents.read.invalid"));
      return;
    }
    const r = await correct({ documentId: row.id, patch });
    const error = extractError(r);
    if (error) return void toast.error(error);
    toast.success(
      t("documents.read.saved", { field: t(`documents.read.field.${key}` as MessageKey) }),
    );
    onLinked();
  }

  const ocrable = ["needs_ocr", "stuck", "ocr_failed"].includes(row.state);
  const untyped = row.prefixType === "document" && row.state === "ready";
  const proposal = untyped ? readingProposes(row.facts) : null;
  const ask = proposal === "ask";
  const kind = kindWord(row);
  const fromSubscription = useSubscriptionMatches(
    { documentId: row.id },
    { enabled: canMake && !ask },
  );
  const subscriptionFirst = fromSubscription.length > 0;

  // --- When you accept (F185) ---
  const [chain, setChain] = useState<AcceptChain | null | undefined>(undefined);
  const { executeAsync: loadChain } = useAction(documentAcceptChainAction);
  const wantsChain = canWrite && canMake && row.state === "ready" && !ask;
  const chainSeq = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chain reads the document as corrected — `updatedAt` says it changed
  useEffect(() => {
    if (!wantsChain) {
      setChain(null);
      return;
    }
    const mine = ++chainSeq.current;
    void loadChain({ documentId: row.id }).then((r) => {
      const d = r?.data && "data" in r.data ? r.data.data : null;
      if (mine === chainSeq.current) setChain(d ?? null);
    });
  }, [row.id, row.updatedAt, wantsChain]);

  const { executeAsync: justify, isPending: justifying } = useAction(justifyRowAction);
  const { executeAsync: createSupplier, isPending: creating } = useAction(
    createSupplierInvoiceAction,
  );
  const { resolveGroupId, isPending: makingGroup } = useCreateGroupIfNew();
  const accepting = justifying || creating || makingGroup;
  const ready = !!chain && chain.missing.length === 0;
  const makeKind = chain?.kind === "expense" ? "expense" : "supplier";

  const accept = useCallback(async () => {
    if (!chain || chain.missing.length > 0 || !chain.group || accepting) return;
    const groupId = chain.group.isNew
      ? await resolveGroupId(NEW_GROUP, chain.group.name, chain.group.month)
      : chain.group.id;
    if (!groupId) return;
    let key = "";
    if (chain.bankRow) {
      const r = await justify(
        chain.kind === "supplier_invoice"
          ? {
              transactionId: chain.bankRow.id,
              documentId: row.id,
              kind: "supplier_invoice",
              supplier: supplierPayload(chain, groupId),
            }
          : {
              transactionId: chain.bankRow.id,
              documentId: row.id,
              kind: "expense",
              expense: expensePayload(chain, groupId),
            },
      );
      const error = extractError(r);
      if (error) return void toast.error(error);
      key = r?.data && "data" in r.data ? (r.data.data?.entity.key ?? "") : "";
    } else {
      const r = await createSupplier({ ...supplierPayload(chain, groupId), documentId: row.id });
      const error = extractError(r);
      if (error) return void toast.error(error);
      key = r?.data && "data" in r.data ? (r.data.data?.key ?? "") : "";
    }
    toast.success(t("documents.chain.done", { key }));
    onAccepted?.({ id: row.id, key, kind: chain.kind, bankRowDate: chain.bankRow?.date ?? null });
  }, [chain, accepting, resolveGroupId, justify, createSupplier, row.id, t, onAccepted]);

  // Enter (the workbench's key): accept, or open the form when the chain lacks something
  const lastAccept = useRef(acceptRequest);
  useEffect(() => {
    if (acceptRequest === lastAccept.current) return;
    lastAccept.current = acceptRequest;
    if (ready) void accept();
    else if (chain && canMake) onMake(makeKind);
  }, [acceptRequest, ready, accept, chain, canMake, onMake, makeKind]);

  // the other bank rows: the links step (or `l`) opens them
  const [rowsOpen, setRowsOpen] = useState(false);
  useEffect(() => {
    if (openSearchKey > 0) setRowsOpen(true);
  }, [openSearchKey]);

  const nodes: ChainNode[] = chain
    ? chainNodes(
        chain,
        t,
        () => onMake(makeKind),
        () => setRowsOpen((o) => !o),
      )
    : [];
  const steps = chain ? chainSteps(chain).length : 0;
  const pages = row.reading?.pages.length ?? 0;
  const readSeconds = row.reading?.readMs ? (row.reading.readMs / 1000).toFixed(1) : null;

  return (
    <>
      {/* the document, its boxes lit by what it read (F141) */}
      <section
        className="flex min-w-0 flex-col items-center gap-3 pulse-card p-5"
        aria-label={row.fileName}
        data-testid="inbox-preview-card"
      >
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <span className="contents" data-testid="inbox-proposes">
            <BoardTag tone={kind.tone}>{t(kind.key)}</BoardTag>
            <span data-public>
              {[
                kind.detected ? t("documents.desk.detected") : null,
                pages > 0
                  ? t(pages === 1 ? "documents.desk.page" : "documents.desk.pages", {
                      count: pages,
                    })
                  : null,
                readSeconds ? t("documents.desk.readIn", { seconds: readSeconds }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <code className="font-mono text-[11px]" data-sensitive data-testid="inbox-pane-key">
            {row.businessKey}
          </code>
          {row.state !== "ready" && <DocumentStateLabel state={row.state} />}
          {marks.length > 0 && (
            <span className="ml-auto hidden xl:inline">{t("documents.desk.previewHint")}</span>
          )}
        </div>
        <div className="relative min-h-[520px] w-full flex-1" data-testid="inbox-preview">
          <div className="absolute inset-0">
            <DocumentPreview
              bare
              fileUrl={fileUrl}
              mimeType={row.mimeType}
              marks={row.reading}
              active={active}
              corrected={corrected}
            />
          </div>
        </div>
      </section>

      {/* what it read, and what one click does with it */}
      <section
        className="flex min-w-0 flex-col gap-1.5 pulse-card p-4"
        aria-label={t("documents.inbox.pane")}
        data-testid="inbox-pane"
      >
        {row.vendor && <h2 className="sr-only">{row.vendor}</h2>}
        {ask && <WhatIsIt documentId={row.id} canWrite={canWrite} onTyped={onLinked} />}
        {row.state === "stuck" && (
          <p className="px-1 text-xs text-muted-foreground">{t("documents.inbox.stuck")}</p>
        )}
        {row.duplicateOf && (
          <p className="px-1 text-xs">
            <Link
              href={`/documents/${row.duplicateOf.id}`}
              className="text-primary hover:underline"
            >
              {t("documents.inbox.sameFileAs", { key: row.duplicateOf.businessKey })}
            </Link>
          </p>
        )}
        {marks.length > 0 ? (
          <WhatItRead
            fields={fields}
            active={active}
            onActive={setActive}
            onAnswer={(k, raw) => void answer(k, raw)}
            canWrite={canWrite}
            busy={correcting}
            formatAmount={(v) => money(v, row.facts.currency ?? null)}
            testId="inbox-what-it-read"
          />
        ) : (
          <p className="px-1 py-2 text-[13px] text-muted-foreground" data-testid="inbox-not-read">
            {t(
              ocrable
                ? row.state === "ocr_failed"
                  ? "documents.desk.notReadFailed"
                  : "documents.desk.notReadYet"
                : "documents.desk.nothingRead",
            )}
          </p>
        )}

        {wantsChain && chain === undefined && (
          <div className="mt-3 flex flex-col gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        )}
        {chain && (
          <AcceptChainView
            nodes={nodes}
            label={
              ready
                ? t(`documents.chain.accept.${acceptLabelKey(steps)}`)
                : t("documents.chain.complete")
            }
            onAccept={() => (ready ? void accept() : onMake(makeKind))}
            disabled={accepting || busy}
            hint={
              ready
                ? chain.group?.isNew
                  ? t("documents.chain.newGroup", { month: chain.group.name })
                  : null
                : t("documents.chain.lacks", {
                    what: chain.missing
                      .map((m) => t(`documents.chain.missing.${m}` as MessageKey))
                      .join(" · "),
                  })
            }
          />
        )}
        {canLink && (
          <div hidden={!rowsOpen} className="mt-2" data-testid="inbox-bank-rows">
            <SuggestionsSection
              target={{ endpoint: { type: "document", id: row.id } }}
              canWrite={canWrite}
              onLinked={onLinked}
              openSearchKey={openSearchKey}
              applyRequest={applyRequest}
              limit={3}
            />
          </div>
        )}

        <div
          className="mt-2 flex flex-wrap items-center gap-1 border-t border-subtle pt-2.5"
          data-testid="inbox-actions"
        >
          {canWrite && ocrable && (
            <Button size="sm" disabled={busy} onClick={onOcr} data-testid="inbox-run-ocr">
              {t("documents.inbox.action.runOcr")}
            </Button>
          )}
          {canMake && !ask && (
            <>
              <FromSubscriptionButtons
                documentId={row.id}
                matches={fromSubscription}
                variant={(canWrite && ocrable) || chain ? "outline" : "default"}
                onConfirmed={onLinked}
              />
              <Button
                size="sm"
                // one primary: *Run OCR* while due, then the chain's, then a subscription's period, then the reading's kind
                variant={
                  !chain &&
                  !(canWrite && ocrable) &&
                  !subscriptionFirst &&
                  proposal !== "supplier_invoice"
                    ? "default"
                    : "ghost"
                }
                onClick={() => onMake("expense")}
                data-testid="inbox-make-expense"
              >
                {t("documents.makeIt.expense")}…
              </Button>
              <Button
                size="sm"
                variant={
                  !chain && !subscriptionFirst && proposal === "supplier_invoice"
                    ? "default"
                    : "ghost"
                }
                onClick={() => onMake("supplier")}
                data-testid="inbox-make-supplier-invoice"
              >
                {t("documents.makeIt.supplierInvoice")}…
              </Button>
            </>
          )}
          {canLink && canWrite && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRowsOpen((o) => !o)}
              aria-expanded={rowsOpen}
              data-testid="inbox-other-rows"
            >
              {t("documents.chain.otherRows")}
            </Button>
          )}
          {canFile && (
            <Button
              size="sm"
              variant="ghost"
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
              variant="ghost"
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
            className="ml-auto"
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

/** The chain's nodes in the board's words — what lacks says so and opens the form that fills it. */
function chainNodes(
  c: AcceptChain,
  t: ReturnType<typeof useT>,
  openForm: () => void,
  toggleRows: () => void,
): ChainNode[] {
  const kindLabel = t(
    c.kind === "supplier_invoice" ? "documents.kind.supplierInvoice" : "documents.kind.expense",
  );
  const lacks = (...m: AcceptChain["missing"]) => m.some((x) => c.missing.includes(x));
  const createsLacking = lacks("invoiceNumber", "amount", "date", "currency", "payer");
  const out: ChainNode[] = [
    {
      verb: "creates",
      lacking: createsLacking,
      onOpen: createsLacking ? openForm : undefined,
      body: (
        <>
          {kindLabel}{" "}
          {c.key && (
            <b className="font-mono font-semibold" data-sensitive data-testid="chain-key">
              {c.key}
            </b>
          )}
          {createsLacking && (
            <span>
              {" "}
              —{" "}
              {c.missing
                .filter((m) => ["invoiceNumber", "amount", "date", "currency", "payer"].includes(m))
                .map((m) => t(`documents.chain.missing.${m}` as MessageKey))
                .join(" · ")}
            </span>
          )}
        </>
      ),
    },
  ];
  if (c.bankRow)
    out.push({
      verb: "links",
      onOpen: toggleRows,
      body: (
        <span className="tabular-nums">
          {t("documents.chain.bankRow", {
            date: c.bankRow.date,
            amount: money(c.bankRow.amount, c.bankRow.currency, true),
          })}
        </span>
      ),
      aside: (
        <span className="text-state-done" data-public>
          {c.bankRow.score} %
        </span>
      ),
    });
  const filesLacking = lacks("category", "partner", "group");
  out.push({
    verb: "files",
    lacking: filesLacking,
    onOpen: filesLacking ? openForm : undefined,
    body: (
      <>
        {c.category ? c.category.label.replace(" · ", " ") : t("documents.chain.missing.category")}
        {" · "}
        {c.partner
          ? t("documents.chain.partner", { name: c.partner.name })
          : c.kind === "supplier_invoice"
            ? t("documents.chain.missing.partner")
            : t("documents.chain.noPartner")}
      </>
    ),
  });
  return out;
}
