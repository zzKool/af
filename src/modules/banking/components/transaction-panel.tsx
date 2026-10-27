"use client";

// The workbench's docked details panel (D40): the title (date · amount · state), the transfer proposal as a
// banner, then the sections About (the row as the bank said it) · Proof (links, suggestions) · Category (the
// base, the categorise form, "create rule from this") · History (collapsed; the audit trail). Self-loading from
// the transaction id (the same view opens from the list, from an import's "show the new rows" and in the inbox's
// right pane).
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
import { acceptTransferAction, getTransactionAction } from "@/modules/banking/banking.actions";
import type { TransactionDetailWire, TransactionWire } from "@/modules/banking/detail-wire";
import { GraphLink, LinksList, SuggestionsSection } from "@/modules/linking/ui";
import { CategoriseForm, type CategoryOption, type PartnerOption } from "./categorise-form";
import { RuleDialog } from "./rule-dialog";
import { TransactionHistory } from "./transaction-history";
import { TransactionStateLabel } from "./transaction-state";

type Detail = TransactionDetailWire;

const money = (amount: string, currency: string) => formatMoney(amount, currency);
/** a rate as the bank / ECB gave it, without trailing zeros */
const rate = (r: string) => r.replace(/0+$/, "").replace(/\.$/, "");

/** The workbench's side panel (a `Sheet`) around the detail view. */
export function TransactionPanel({
  transactionId,
  onClose,
  categories,
  partners,
  canWrite,
  onChanged,
}: {
  transactionId: string | null;
  onClose: () => void;
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
  /** something was saved — the list behind the panel should refresh */
  onChanged?: () => void;
}) {
  return (
    <Sheet open={!!transactionId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="transaction-panel">
        {transactionId && (
          <TransactionDetailView
            transactionId={transactionId}
            categories={categories}
            partners={partners}
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
 * One bank row in full — the row as the bank said it, its facts, the suggestions, the links, the transfer
 * proposal, "create rule from this". Self-loading from the id; the side panel and the inbox's right pane share it.
 */
export function TransactionDetailView({
  transactionId,
  categories,
  partners,
  canWrite,
  onChanged,
  header,
  openSearchKey = 0,
}: {
  transactionId: string;
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
  /** something was saved — the list behind the panel should refresh */
  onChanged?: () => void;
  /** how the host frames the title line (the Sheet's header, or a plain heading) */
  header: (title: ReactNode, description: ReactNode) => ReactNode;
  /** bump it to open "Link to…" with the keyboard (the inbox's `l`) */
  openSearchKey?: number;
}) {
  const t = useT();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const { executeAsync: load } = useAction(getTransactionAction);
  const { executeAsync: accept, isPending: accepting } = useAction(acceptTransferAction);

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

  return (
    <div className="flex flex-col gap-4" data-testid="transaction-detail">
      {tx && detail ? (
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

          <div className="flex flex-col">
            <DetailsSection title={t("banking.panel.raw")}>
              <DetailsGrid rows={about} />
            </DetailsSection>

            <DetailsSection title={t("banking.panel.links")}>
              <div className="flex flex-col gap-4">
                <div className="flex justify-end">
                  <GraphLink self={{ type: "bank_transaction", id: tx.id }} />
                </div>
                <LinksList
                  self={{ type: "bank_transaction", id: tx.id }}
                  links={detail.links}
                  canWrite={canWrite}
                  fallbackCurrency={tx.currency}
                  onChanged={changed}
                />
                {/* what this row could justify — the scored candidates, "Link to…" (specs/linking) */}
                {detail.state !== "no_document" && (
                  <SuggestionsSection
                    target={{ bankTransactionId: tx.id }}
                    canWrite={canWrite}
                    onLinked={changed}
                    refreshKey={version}
                    openSearchKey={openSearchKey}
                  />
                )}
              </div>
            </DetailsSection>

            <DetailsSection title={t("banking.panel.journal")}>
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t("banking.panel.base", {
                    base: formatMoney(tx.amountBase, "SEK", { bare: true }),
                    rate: tx.rate,
                    source: t(`banking.rateSource.${tx.rateSource}`),
                  })}
                  {tx.bankImplicitRate
                    ? ` · ${t("banking.panel.implicitRate", { rate: rate(tx.bankImplicitRate) })}`
                    : ""}
                </p>
                <CategoriseForm
                  entry={tx}
                  categories={categories}
                  partners={partners}
                  canWrite={canWrite}
                  onSaved={rowSaved}
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
              </div>
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
              }}
              categories={categories}
              partners={partners}
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
