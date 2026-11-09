"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
// The work surface (F131, review 2026-10-31 §6.2 / O1; D76 Pulse; F152): the docked details panel of the banking list,
// beside the list below the cards (38 % of that row by default, resizable, remembered per table — the kit's
// `SheetContent`). On top the row as a hero — who, the bank text, the amount large, the date and account, the state
// with one sentence of what is left (`rowVerdict`), ↑ ↓ through the page — then **three numbered steps**, each
// marked done / proposed / missing / not needed (`rowSteps`, the list's three dots) and each holding its own control
// (the owner, 2026-11-09): **1 · Proof** (the Justify panel; the links and the suggestions, each openable — a
// document's file in a preview), **2 · Partner** (the partner picker) and **3 · Category** (the category and the
// note, *Create rule from this*), the Proposed line above 2 and 3; the currency card for a foreign row; and two
// collapsed footers, *As the bank said* (the raw row) and *History*. Self-loading from the transaction id (the same
// view opens from the list, from an import's "show the new rows" and in the inbox's right pane).
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { InfoBanner } from "@/kernel/ui/info-banner";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import { acceptTransferAction, getTransactionAction } from "@/modules/banking/banking.actions";
import type { TransactionDetailWire, TransactionWire } from "@/modules/banking/detail-wire";
import { fxCard } from "@/modules/banking/fx-card";
import {
  missingSteps,
  rowSteps,
  rowVerdict,
  type StepKey,
  type StepStatus,
} from "@/modules/banking/steps";
import {
  GraphLink,
  type JustifyOptions,
  JustifyPanel,
  LinksList,
  ProposalLine,
  prefillFromProposals,
  SuggestionsSection,
  useRowProposals,
} from "@/modules/linking/ui";
import { CategoriseForm, type CategoryOption, type PartnerOption } from "./categorise-form";
import { RuleDialog } from "./rule-dialog";
import { TransactionHistory } from "./transaction-history";
import { TransactionStateLabel } from "./transaction-state";

type Detail = TransactionDetailWire;

/** the work surface's default share of the canvas (O1, 2026-11-03: 55 %; D76 the Pulse board: 38 %, the list's
 *  five columns beside it at 1440 px) — the list keeps the rest; a width the owner drags is remembered */
export const WORK_SURFACE_WIDTH = "38%" as const;

/** a proposal's source as the BAS picker names it (F125) */
const BAS_SOURCE: Record<string, "rule" | "partner" | "history" | "model"> = {
  rule: "rule",
  partner_default: "partner",
  memory: "history",
  model: "model",
};
/** the states the Justify panel shows on (F129): still to prove, or flagged without the partner it lacks */
const JUSTIFY_STATES = new Set<TransactionDetailWire["state"]>([
  "open",
  "partial",
  "no_document_no_partner",
]);
/** the states the statement or the flag proves: nothing to suggest */
const NO_DOCUMENT_STATES = new Set<TransactionDetailWire["state"]>([
  "no_document",
  "no_document_no_partner",
]);

/** the books' currency (D46: SEK in code until F70 — this file's one base read) */
const BASE = "SEK";

const money = (amount: string, currency: string) => formatMoney(amount, currency);
/** a rate as the bank / ECB gave it, without trailing zeros */
const rate = (r: string) => r.replace(/0+$/, "").replace(/\.$/, "");

/** the open row's place in the list's page, and the ↑ ↓ moves (absent outside the list) */
export type RowNav = { index: number; total: number; prev?: () => void; next?: () => void };

/** The workbench's side panel (a `Sheet`) around the detail view — the work surface, 55 % wide by default. */
export function TransactionPanel({
  transactionId,
  nav,
  onClose,
  categories,
  partners,
  justifyOptions = null,
  canWrite,
  onChanged,
}: {
  transactionId: string | null;
  nav?: RowNav;
  onClose: () => void;
  categories: CategoryOption[];
  partners: PartnerOption[];
  /** the Justify panel's option lists (F97); null hides it */
  justifyOptions?: JustifyOptions | null;
  canWrite: boolean;
  /** something was saved — the list behind the panel should refresh */
  onChanged?: () => void;
}) {
  return (
    <Sheet open={!!transactionId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="transaction-panel" defaultWidth={WORK_SURFACE_WIDTH}>
        {transactionId && (
          <TransactionDetailView
            transactionId={transactionId}
            nav={nav}
            categories={categories}
            partners={partners}
            justifyOptions={justifyOptions}
            canWrite={canWrite}
            onChanged={onChanged}
            header={(title, description) => (
              <SheetHeader>
                <SheetTitle className="flex min-w-0 items-center gap-3">{title}</SheetTitle>
                <SheetDescription>{description}</SheetDescription>
              </SheetHeader>
            )}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

const MARK: Record<StepStatus, { glyph: string; tone: string }> = {
  done: { glyph: "✓", tone: "bg-state-done/15 text-state-done" },
  proposed: { glyph: "?", tone: "bg-state-progress/15 text-state-progress" },
  partial: { glyph: "½", tone: "bg-state-progress/15 text-state-progress" },
  missing: { glyph: "!", tone: "bg-state-attention/15 text-state-attention" },
  none: { glyph: "–", tone: "bg-tag text-muted-foreground" },
};

/**
 * One numbered step of the work surface (D76): its mark (✓ ? ½ ! –, coloured by status — the word says it too),
 * `n · Title`, the status word, one line of what is there; the step's own controls below.
 */
function Step({
  n,
  step,
  status,
  text,
  testId,
  children,
}: {
  n: number;
  step: StepKey;
  status: StepStatus;
  text: ReactNode;
  testId?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const mark = MARK[status];
  return (
    // not a named region: its heading carries the structure, and "Category" must stay the form field's label alone
    <section
      data-testid={testId}
      data-step={step}
      data-status={status}
      className="flex gap-3 border-t border-subtle pt-3.5"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold",
          mark.tone,
        )}
      >
        {mark.glyph}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            {`${n} · ${t(`banking.step.${step}`)}`}
            <span className="text-xs font-normal text-muted-foreground">
              {t(`banking.stepStatus.${status}`)}
            </span>
          </h3>
          <div className="min-w-0 text-[12.5px] text-muted-foreground">{text}</div>
        </div>
        {children}
      </div>
    </section>
  );
}

/**
 * One bank row in full — the three zones and the two footers. Self-loading from the id; the side panel and
 * the inbox's right pane share it.
 */
export function TransactionDetailView({
  transactionId,
  nav,
  categories,
  partners,
  justifyOptions = null,
  canWrite,
  onChanged,
  header,
  openSearchKey = 0,
  proofKey = 0,
  noProofKey = 0,
  lostKey = 0,
  acceptKey = 0,
  rejectKey = 0,
}: {
  transactionId: string;
  /** the list's ↑ ↓ (the side panel); absent in the inbox */
  nav?: RowNav;
  categories: CategoryOption[];
  partners: PartnerOption[];
  /** the Justify panel's option lists (F97); null hides the panel */
  justifyOptions?: JustifyOptions | null;
  canWrite: boolean;
  /** something was saved — the list behind the panel should refresh */
  onChanged?: () => void;
  /** how the host frames the title line (the Sheet's header, or a plain heading) */
  header: (title: ReactNode, description: ReactNode) => ReactNode;
  /** bump it to open "Link to…" with the keyboard (the inbox's `l`) */
  openSearchKey?: number;
  /** the inbox's `p` · `n` · `x` (F97): drop the proof, no proof needed, receipt lost */
  proofKey?: number;
  noProofKey?: number;
  lostKey?: number;
  /** the inbox's `a` · `r` (F98): accept / reject the row's proposals */
  acceptKey?: number;
  rejectKey?: number;
}) {
  const t = useT();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const { executeAsync: load } = useAction(getTransactionAction);
  const { executeAsync: accept, isPending: accepting } = useAction(acceptTransferAction);
  // F98: the row's current proposals — the Proposed line and the form's pre-fill read the same list
  const { proposals } = useRowProposals(transactionId, version);

  const reload = useCallback(async () => {
    if (!transactionId) return;
    const r = await load({ id: transactionId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) setDetail(d);
  }, [transactionId, load]);

  useEffect(() => {
    setDetail(null);
    void reload();
  }, [reload]);

  function changed() {
    void reload();
    setVersion((v) => v + 1);
    onChanged?.();
    router.refresh();
  }

  /** the categorise form hands back the saved row — shown at once, before the reload lands (the implied rate is
   * the pair's, unchanged by a categorisation) */
  function rowSaved(row: TransactionWire) {
    setDetail((d) =>
      d ? { ...d, transaction: { ...row, bankImplicitRate: d.transaction.bankImplicitRate } } : d,
    );
    changed();
  }

  async function acceptPair(fromId: string, toId: string) {
    const r = await accept({ fromId, toId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.panel.transferAccepted"));
    changed();
  }

  const tx = detail?.transaction;
  // the Nordea columns keep the export's own (English) names — what the owner sees in the CSV
  const about: [ReactNode, ReactNode][] =
    tx && detail
      ? [
          ["Sender", tx.sender],
          ["Recipient", tx.recipient],
          ["Name", tx.name],
          ["Additional details", tx.additionalDetails],
          ["Message", tx.message],
          ["Own notes", tx.ownNotes],
          [
            "Balance",
            tx.balance ? (
              <span key="balance" className="tabular-nums">
                {money(tx.balance, tx.currency)}
              </span>
            ) : null,
          ],
          [t("banking.col.counterparty"), <CodeChip key="cp">{tx.counterpartyKey}</CodeChip>],
          [
            t("banking.panel.import"),
            detail.import ? (
              <span key="import" className="font-mono text-xs">
                {detail.import.fileName}
              </span>
            ) : null,
          ],
        ]
      : [];

  const self = tx ? ({ type: "bank_transaction", id: tx.id } as const) : null;
  const fx = tx ? fxCard(tx, BASE) : null;

  // D76: the three steps — what the row carries, what waits as a proposal
  const basProposal = proposals.find((p) => p.kind === "bas");
  const steps =
    detail && tx
      ? rowSteps({
          state: detail.state,
          partnerId: detail.effective.partnerId,
          basCode: detail.effective.basCode,
          proposedBasCode: basProposal?.kind === "bas" ? basProposal.payload.basCode : null,
          proposedPartner: proposals.some((p) => p.kind === "partner"),
        })
      : null;
  const verdict = steps ? rowVerdict(steps) : null;
  const who = detail?.effective.partnerName ?? tx?.counterpartyKey ?? "";
  const source = (from: string | null) =>
    from === "proof" ? t("banking.facts.fromProof") : t("banking.steps.typed");

  const proofText = (status: StepStatus) => {
    if (!tx || !detail) return null;
    if (status === "done")
      return t("banking.steps.proof.done", { count: detail.links.length || 1 });
    if (status === "partial")
      return t("banking.steps.proof.partial", {
        allocated: formatMoney(detail.allocated, tx.currency),
        amount: formatMoney(tx.amount.replace("-", ""), tx.currency),
      });
    if (status === "none")
      return tx.noDocumentNeeded
        ? t("banking.zone.proofFlagged")
        : t("banking.zone.proofStatement");
    return t("banking.steps.proof.missing");
  };
  const partnerText = (status: StepStatus) => {
    if (!detail) return null;
    if (status === "done")
      return `${detail.effective.partnerName ?? ""} — ${source(detail.effective.partnerFrom)}`;
    if (status === "proposed") return t("banking.steps.partner.proposed");
    if (status === "none") return t("banking.steps.partner.none");
    return t("banking.steps.partner.missing");
  };
  const categoryText = (status: StepStatus) => {
    if (!detail) return null;
    if (status === "done")
      return `${detail.effective.basLabel ?? detail.effective.basCode ?? ""} — ${source(detail.effective.basFrom)}`;
    if (status === "proposed" && basProposal?.kind === "bas")
      return t("banking.steps.category.proposed", { code: basProposal.payload.basCode });
    if (status === "none") return t("banking.steps.category.none");
    return t("banking.steps.category.missing");
  };

  return (
    <div className="@container flex flex-col gap-4" data-testid="transaction-detail">
      {tx && detail && self && steps && verdict ? (
        <>
          {nav && (
            <div className="-mb-1 flex items-center gap-1 pr-16 text-xs text-muted-foreground">
              <span data-testid="panel-position">
                {t("banking.panel.position", { n: nav.index + 1, total: nav.total })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label={t("banking.panel.prev")}
                title={t("banking.panel.prev")}
                disabled={!nav.prev}
                onClick={nav.prev}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("banking.panel.next")}
                title={t("banking.panel.next")}
                disabled={!nav.next}
                onClick={nav.next}
              >
                <ArrowDown />
              </Button>
            </div>
          )}
          {header(
            <>
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-tag text-lg font-bold"
              >
                {(who.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase()}
              </span>
              <span className="min-w-0 truncate text-xl font-semibold tracking-tight">{who}</span>
            </>,
            <span className="block truncate font-mono text-[11.5px]" title={tx.description}>
              {tx.description}
            </span>,
          )}

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={cn(
                "font-mono text-[28px] leading-8 font-medium tracking-tight tabular-nums",
                !tx.amount.startsWith("-") && "text-state-done",
              )}
              data-testid="panel-amount"
            >
              {formatMoney(tx.amount, tx.currency, { signed: true })}
            </span>
            <span className="text-xs text-muted-foreground">
              <span className="tabular-nums">{tx.bookingDate}</span> · {detail.accountLabel}
            </span>
          </div>

          {/* the bank's facts in one line: who, the reference, the base */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            data-testid="zone-row"
          >
            <CodeChip>{tx.counterpartyKey}</CodeChip>
            <span className="text-muted-foreground">
              {t("banking.zone.reference")}{" "}
              <span className="text-foreground" data-testid="row-reference">
                {tx.reference ?? "—"}
              </span>
            </span>
            <span className="text-muted-foreground tabular-nums" data-testid="row-base">
              {t("banking.zone.base")}{" "}
              <span className="text-foreground">{formatMoney(tx.amountBase, BASE)}</span>{" "}
              {t("banking.zone.atRate", {
                rate: tx.rate,
                source: t(`banking.rateSource.${tx.rateSource}`),
              })}
              {tx.bankImplicitRate
                ? ` · ${t("banking.panel.implicitRate", { rate: rate(tx.bankImplicitRate) })}`
                : ""}
            </span>
          </div>

          {/* the state and what is left, in one sentence */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-subtle bg-surface-2 px-3 py-2.5">
            <TransactionStateLabel state={detail.state} testId="panel-state" />
            <span className="text-[12.5px]" data-testid="panel-verdict">
              {verdict === "missing"
                ? t("banking.verdict.missing", { count: missingSteps(steps) })
                : t(`banking.verdict.${verdict}`)}
            </span>
          </div>

          {/* what to do next with this row: accept the proposed transfer pair */}
          {canWrite &&
            detail.transfers.map((p) => (
              <InfoBanner
                key={p.to.id}
                action={
                  <Button
                    size="sm"
                    onClick={() => void acceptPair(p.from.id, p.to.id)}
                    disabled={accepting}
                    data-testid="accept-transfer"
                  >
                    {t("banking.panel.acceptTransfer")}
                  </Button>
                }
              >
                <div className="font-semibold">{t("banking.panel.transfer")}</div>
                <div className="tabular-nums">
                  {t("banking.panel.transferReason", {
                    from: money(p.from.amount, p.from.currency),
                    to: money(p.to.amount, p.to.currency),
                    implied: rate(p.implied),
                  })}
                </div>
                {p.ecb && (
                  <div className="text-xs text-muted-foreground">
                    {t("banking.panel.transferEcb", {
                      ecb: rate(p.ecb),
                      deviation: p.deviationPercent ?? "0",
                    })}
                    {p.hints.length ? ` · ${p.hints.join(", ")}` : ""}
                  </div>
                )}
              </InfoBanner>
            ))}

          <div className="flex flex-col gap-3">
            {/* 1 · PROOF — justify from the row (F97): the drop zone, what is already here, the reasons, the
                receipt lost; then the links this row has and the scored candidates it could still justify */}
            <Step
              n={1}
              step="proof"
              status={steps.proof}
              text={
                steps.proof === "none" ? (
                  <span data-testid="proof-none-needed">{proofText(steps.proof)}</span>
                ) : (
                  proofText(steps.proof)
                )
              }
              testId="zone-proof"
            >
              {canWrite && justifyOptions && JUSTIFY_STATES.has(detail.state) && (
                // the step is the heading: the panel's own section header (F97's *Justify*) is not shown here
                <div className="[&>section]:border-t-0 [&>section]:pt-0 [&>section>button]:hidden">
                  <JustifyPanel
                    row={{
                      id: tx.id,
                      bookingDate: tx.bookingDate,
                      amount: tx.amount,
                      currency: tx.currency,
                      amountBase: tx.amountBase,
                      description: tx.description,
                      counterpartyKey: tx.counterpartyKey,
                      bankAccountId: tx.bankAccountId,
                      accountLabel: detail.accountLabel,
                    }}
                    canWrite={canWrite}
                    options={justifyOptions}
                    proposals={proposals}
                    onDone={changed}
                    onProofRead={changed}
                    proofKey={proofKey}
                    noProofKey={noProofKey}
                    lostKey={lostKey}
                  />
                </div>
              )}
              {detail.links.length > 0 && (
                <div className="flex flex-col gap-2" data-testid="proof-links">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{t("banking.panel.links")}</span>
                    <GraphLink self={self} />
                  </div>
                  <LinksList
                    self={self}
                    links={detail.links}
                    canWrite={canWrite}
                    fallbackCurrency={tx.currency}
                    onChanged={changed}
                  />
                </div>
              )}
              {/* what this row could justify — the scored candidates, "Link to…" (specs/linking) */}
              {!NO_DOCUMENT_STATES.has(detail.state) && (
                <SuggestionsSection
                  target={{ bankTransactionId: tx.id }}
                  canWrite={canWrite}
                  onLinked={changed}
                  refreshKey={version}
                  openSearchKey={openSearchKey}
                />
              )}
              {/* flagged *no document needed*: the flag itself, to take it back */}
              {canWrite && tx.noDocumentNeeded && (
                <CategoriseForm
                  part="noDocument"
                  entry={tx}
                  categories={categories}
                  partners={partners}
                  canWrite={canWrite}
                  onSaved={rowSaved}
                />
              )}
              {detail.links.length === 0 && NO_DOCUMENT_STATES.has(detail.state) && (
                <div className="flex justify-end">
                  <GraphLink self={self} />
                </div>
              )}
            </Step>

            {/* 2 · PARTNER and 3 · CATEGORY — each step holds its own control (the owner, 2026-11-09); the
                Proposed line (F98) above them, for both */}
            <div className="flex flex-col gap-3" data-testid="zone-facts">
              <ProposalLine
                transactionId={tx.id}
                proposals={proposals}
                options={{ categories, partners }}
                canWrite={canWrite}
                acceptKey={acceptKey}
                rejectKey={rejectKey}
                onDecided={(accepted) => {
                  changed();
                  if (accepted?.proposeRule)
                    toast.message(t("linking.proposals.ruleOffer"), {
                      action: {
                        label: t("banking.panel.createRule"),
                        onClick: () => setRuleOpen(true),
                      },
                    });
                }}
              />
              <Step
                n={2}
                step="partner"
                status={steps.partner}
                text={partnerText(steps.partner)}
                testId="step-partner"
              >
                {detail.effective.partnerFrom === "proof" && (
                  <span
                    className="inline-flex flex-wrap items-center gap-1.5 text-[13px]"
                    data-testid="effective-partner"
                  >
                    {detail.effective.partnerName}
                    <Tag>{t("banking.facts.fromProof")}</Tag>
                  </span>
                )}
                {steps.partner !== "none" && (
                  <CategoriseForm
                    part="partner"
                    entry={tx}
                    categories={categories}
                    partners={partners}
                    canWrite={canWrite}
                    onSaved={rowSaved}
                    prefill={prefillFromProposals(proposals)}
                  />
                )}
              </Step>
              <Step
                n={3}
                step="category"
                status={steps.category}
                text={categoryText(steps.category)}
                testId="step-category"
              >
                {(detail.effective.basFrom === "proof" || detail.effective.mixed) && (
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px]">
                    {detail.effective.basFrom === "proof" && (
                      <span
                        className="inline-flex flex-wrap items-center gap-1.5"
                        data-testid="effective-category"
                      >
                        {detail.effective.basLabel}
                        <Tag>{t("banking.facts.fromProof")}</Tag>
                      </span>
                    )}
                    {detail.effective.mixed && (
                      <span className="inline-flex" data-testid="effective-mixed">
                        <Tag>{t("banking.facts.mixed")}</Tag>
                      </span>
                    )}
                  </span>
                )}
                <CategoriseForm
                  part="category"
                  entry={tx}
                  categories={categories}
                  partners={partners}
                  canWrite={canWrite}
                  onSaved={rowSaved}
                  prefill={prefillFromProposals(proposals)}
                  suggestions={proposals.flatMap((p) =>
                    p.kind === "bas"
                      ? [
                          {
                            code: p.payload.basCode,
                            source: BAS_SOURCE[p.source] ?? ("proposal" as const),
                            ...(p.reason ? { reason: p.reason } : {}),
                          },
                        ]
                      : [],
                  )}
                  direction={Number(tx.amount) < 0 ? "cost" : "income"}
                />
                {canWrite && (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRuleOpen(true)}
                      data-testid="create-rule"
                    >
                      {t("banking.panel.createRule")}
                    </Button>
                  </div>
                )}
              </Step>
            </div>

            {/* the board's *Currency conversion*: a foreign row's ECB base, and the bank's rate on a transfer leg */}
            {fx && (
              <section
                className="flex flex-col gap-2 rounded-xl border border-subtle bg-surface-2 px-3 py-2.5 text-[12.5px]"
                data-testid="fx-card"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">{t("banking.fx.title")}</h3>
                  {fx.bank && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t("banking.fx.percent", { percent: fx.bank.percent })}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">{t("banking.fx.original")}</dt>
                  <dd />
                  <dd className="text-right tabular-nums">
                    {money(fx.original.amount, fx.original.currency)}
                  </dd>
                  <dt className="text-muted-foreground">
                    {t("banking.fx.ecb", { source: t(`banking.rateSource.${tx.rateSource}`) })}
                  </dt>
                  <dd className="text-right text-muted-foreground tabular-nums">
                    {rate(fx.ecb.rate)}
                  </dd>
                  <dd className="text-right tabular-nums">{money(fx.ecb.amount, BASE)}</dd>
                  {fx.bank && (
                    <>
                      <dt className="text-muted-foreground">{t("banking.fx.bank")}</dt>
                      <dd className="text-right text-muted-foreground tabular-nums">
                        {rate(fx.bank.rate)}
                      </dd>
                      <dd className="text-right tabular-nums">{money(fx.bank.amount, BASE)}</dd>
                      <dt className="font-medium">{t("banking.fx.cost")}</dt>
                      <dd />
                      <dd className="text-right font-medium tabular-nums">
                        {money(fx.bank.cost, BASE)}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            {/* the footers, closed by default — their open state is not remembered */}
            <DetailsSection title={t("banking.panel.raw")} defaultOpen={false}>
              <DetailsGrid rows={about} />
            </DetailsSection>
            <TransactionHistory transactionId={tx.id} refreshKey={version} />
          </div>

          {/* D76: the panel's foot, always in view — the inbox for the rows with candidates, the next row */}
          {nav && (
            <div className="sticky -bottom-3.5 -mx-4 mt-auto flex items-center gap-2 border-t border-subtle bg-surface px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/banking/reconcile?row=${tx.id}`} />}
              >
                {t("banking.panel.openReconcile")}
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                disabled={!nav.next}
                onClick={nav.next}
                data-testid="panel-next"
              >
                {t("banking.panel.nextRow")}
                <ArrowDown aria-hidden />
              </Button>
            </div>
          )}

          {canWrite && (
            <RuleDialog
              open={ruleOpen}
              onOpenChange={setRuleOpen}
              fromTransactionId={tx.id}
              initial={{
                name: tx.counterpartyKey,
                matchPattern: tx.counterpartyKey,
                basCode: tx.basCode,
                partnerId: tx.partnerId,
                noDocumentNeeded: tx.noDocumentNeeded,
                // F116 PR C1: the row's account and direction; the amount stays open (a price change is not a new
                // counterparty) — the owner types it when the rule should hold one price
                bankAccountId: tx.bankAccountId,
                sign: Number(tx.amount) > 0 ? "in" : "out",
              }}
              categories={categories}
              partners={partners}
              accounts={[{ id: tx.bankAccountId, label: detail.accountLabel }]}
              onSaved={changed}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">…</p>
      )}
    </div>
  );
}
