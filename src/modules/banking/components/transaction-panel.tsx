"use client";

// The work surface (F131, review 2026-10-31 §6.2 / O1): the docked details panel of the banking list, wide
// (≈ 55 % of the canvas by default, resizable, remembered per table — the kit's `SheetContent`), with three
// zones instead of the seven stacked sections of F97 — **the row** (the bank facts in one line), **the proof**
// (the Justify panel: drop · use what is here · pick · no proof needed · receipt lost; the links; the scored
// candidates), **the facts** (partner · category · note with their source words, the Proposed line) — and two
// collapsed footers, *As the bank said* (the raw row) and *History*. Self-loading from the transaction id (the
// same view opens from the list, from an import's "show the new rows" and in the inbox's right pane).
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
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
import { acceptTransferAction, getTransactionAction } from "@/modules/banking/banking.actions";
import type { TransactionDetailWire, TransactionWire } from "@/modules/banking/detail-wire";
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

/** the work surface's default share of the canvas (O1, 2026-11-03) — the list keeps the rest */
export const WORK_SURFACE_WIDTH = "55%" as const;

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

const money = (amount: string, currency: string) => formatMoney(amount, currency);
/** a rate as the bank / ECB gave it, without trailing zeros */
const rate = (r: string) => r.replace(/0+$/, "").replace(/\.$/, "");

/** The workbench's side panel (a `Sheet`) around the detail view — the work surface, 55 % wide by default. */
export function TransactionPanel({
  transactionId,
  onClose,
  categories,
  partners,
  justifyOptions = null,
  canWrite,
  onChanged,
}: {
  transactionId: string | null;
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
            categories={categories}
            partners={partners}
            justifyOptions={justifyOptions}
            canWrite={canWrite}
            onChanged={onChanged}
            header={(title, description) => (
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">{title}</SheetTitle>
                <SheetDescription>{description}</SheetDescription>
              </SheetHeader>
            )}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * One zone of the work surface: a small-caps label (left when the surface is wide, above when narrow) and its
 * content. Not collapsible — the footers below the zones are the `DetailsSection`s.
 */
function Zone({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className="grid gap-x-4 gap-y-1.5 border-t border-subtle pt-3 @lg:grid-cols-[88px_minmax(0,1fr)]"
    >
      <h3
        id={id}
        className="pt-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {title}
      </h3>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * One bank row in full — the three zones and the two footers. Self-loading from the id; the side panel and
 * the inbox's right pane share it.
 */
export function TransactionDetailView({
  transactionId,
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

  // F129 (D73): what the row shows when nothing is typed — the proof's partner and category, derived on read; the
  // form edits the typed value, which wins
  const effectiveRows: [ReactNode, ReactNode][] = detail
    ? [
        ...(detail.effective.partnerFrom === "proof"
          ? ([
              [
                t("banking.form.partner"),
                <span
                  key="p"
                  className="inline-flex flex-wrap items-center gap-1.5"
                  data-testid="effective-partner"
                >
                  {detail.effective.partnerName}
                  <Tag>{t("banking.facts.fromProof")}</Tag>
                </span>,
              ],
            ] as [ReactNode, ReactNode][])
          : []),
        ...(detail.effective.basFrom === "proof"
          ? ([
              [
                t("banking.form.category"),
                <span
                  key="c"
                  className="inline-flex flex-wrap items-center gap-1.5"
                  data-testid="effective-category"
                >
                  {detail.effective.basLabel}
                  <Tag>{t("banking.facts.fromProof")}</Tag>
                </span>,
              ],
            ] as [ReactNode, ReactNode][])
          : []),
        ...(detail.effective.mixed
          ? ([
              [
                t("banking.col.mixed"),
                <span key="m" className="inline-flex" data-testid="effective-mixed">
                  <Tag>{t("banking.facts.mixed")}</Tag>
                </span>,
              ],
            ] as [ReactNode, ReactNode][])
          : []),
      ]
    : [];

  const self = tx ? ({ type: "bank_transaction", id: tx.id } as const) : null;

  return (
    <div className="@container flex flex-col gap-4" data-testid="transaction-detail">
      {tx && detail && self ? (
        <>
          {header(
            <>
              <span className="tabular-nums">{tx.bookingDate}</span>
              <span
                className={`tabular-nums ${tx.amount.startsWith("-") ? "" : "text-state-done"}`}
                data-testid="panel-amount"
              >
                {formatMoney(tx.amount, tx.currency, { signed: true })}
              </span>
              <TransactionStateLabel state={detail.state} testId="panel-state" />
            </>,
            <span className="flex flex-wrap items-center gap-1.5">
              <Tag>{detail.accountLabel}</Tag>
              <span className="min-w-0 break-words">{tx.description}</span>
            </span>,
          )}

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
            {/* THE ROW — the bank's facts in one line: who, the reference, the base */}
            <Zone title={t("banking.zone.row")} testId="zone-row">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <CodeChip>{tx.counterpartyKey}</CodeChip>
                <span className="text-muted-foreground">
                  {t("banking.zone.reference")}{" "}
                  <span className="text-foreground" data-testid="row-reference">
                    {tx.reference ?? "—"}
                  </span>
                </span>
                <span className="text-muted-foreground tabular-nums" data-testid="row-base">
                  {t("banking.zone.base")}{" "}
                  <span className="text-foreground">{formatMoney(tx.amountBase, "SEK")}</span>{" "}
                  {t("banking.zone.atRate", {
                    rate: tx.rate,
                    source: t(`banking.rateSource.${tx.rateSource}`),
                  })}
                  {tx.bankImplicitRate
                    ? ` · ${t("banking.panel.implicitRate", { rate: rate(tx.bankImplicitRate) })}`
                    : ""}
                </span>
              </div>
            </Zone>

            {/* THE PROOF — justify from the row (F97): the drop zone, what is already here, the reasons, the receipt
                lost; then the links this row has and the scored candidates it could still justify */}
            <Zone title={t("banking.zone.proof")} testId="zone-proof">
              {canWrite && justifyOptions && JUSTIFY_STATES.has(detail.state) && (
                // the zone is the heading: the panel's own section header (F97's *Justify*) is not shown here
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
              {/* a row the statement or the flag proves, with no link to show: say what the proof is */}
              {NO_DOCUMENT_STATES.has(detail.state) && detail.links.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="proof-none-needed">
                  {tx.noDocumentNeeded
                    ? t("banking.zone.proofFlagged")
                    : t("banking.zone.proofStatement")}
                </p>
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
              {detail.links.length === 0 && NO_DOCUMENT_STATES.has(detail.state) && (
                <div className="flex justify-end">
                  <GraphLink self={self} />
                </div>
              )}
            </Zone>

            {/* THE FACTS — partner · category · note, with where each comes from; the Proposed line (F98) */}
            <Zone title={t("banking.zone.facts")} testId="zone-facts">
              {effectiveRows.length > 0 && <DetailsGrid rows={effectiveRows} />}
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
              <CategoriseForm
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
            </Zone>

            {/* the footers, closed by default — their open state is not remembered */}
            <DetailsSection title={t("banking.panel.raw")} defaultOpen={false}>
              <DetailsGrid rows={about} />
            </DetailsSection>
            <TransactionHistory transactionId={tx.id} refreshKey={version} />
          </div>

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
