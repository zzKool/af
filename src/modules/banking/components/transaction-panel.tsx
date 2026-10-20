"use client";

import { useRouter } from "next/navigation";
// The workbench's side panel: the row as the bank said it, the journal entry (categorise form), the links,
// the transfer proposal, "create rule from this". Self-loading from the transaction id (the same panel opens
// from the list and from an import's "show the new rows").
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { acceptTransferAction, getTransactionAction } from "@/modules/banking/banking.actions";
import type { TransactionDetail } from "@/modules/banking/queries";
import type { TransactionState } from "@/modules/banking/types";
import { CategoriseForm, type CategoryOption, type PartnerOption } from "@/modules/journal/ui";
import { LinksList, SuggestionsSection } from "@/modules/linking/ui";
import { RuleDialog } from "./rule-dialog";

export const STATE_STYLE: Record<TransactionState, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  partial: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  linked: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  no_document: "bg-muted text-muted-foreground",
};

type Detail = Omit<TransactionDetail, "transaction" | "entry" | "links" | "import"> & {
  transaction: Omit<TransactionDetail["transaction"], "createdAt"> & { createdAt: string };
  entry:
    | (Omit<NonNullable<TransactionDetail["entry"]>, "createdAt" | "updatedAt"> & {
        createdAt: string;
        updatedAt: string;
      })
    | null;
  links: (Omit<TransactionDetail["links"][number], "createdAt"> & { createdAt: string })[];
  import:
    | (Omit<NonNullable<TransactionDetail["import"]>, "importedAt"> & { importedAt: string })
    | null;
};

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

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
    if (d) setDetail(d as unknown as Detail);
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

  /** the categorise form hands back the saved entry — shown at once, before the reload lands */
  function entrySaved(entry: NonNullable<Detail["entry"]>) {
    setDetail((d) => (d ? { ...d, entry } : d));
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
  const raw: [string, string | null][] = tx
    ? [
        ["Sender", tx.sender],
        ["Recipient", tx.recipient],
        ["Name", tx.name],
        ["Additional details", tx.additionalDetails],
        ["Message", tx.message],
        ["Own notes", tx.ownNotes],
        ["Balance", tx.balance ? money(tx.balance, tx.currency) : null],
      ]
    : [];

  return (
    <Sheet open={!!transactionId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="transaction-panel">
        {tx && detail ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{tx.bookingDate}</span>
                <span
                  className={`tabular-nums ${tx.amount.startsWith("-") ? "" : "text-green-700 dark:text-green-400"}`}
                  data-testid="panel-amount"
                >
                  {money(tx.amount, tx.currency)}
                </span>
                <Badge
                  variant="outline"
                  className={STATE_STYLE[detail.state]}
                  data-testid="panel-state"
                >
                  {t(`banking.state.${detail.state}`)}
                </Badge>
              </SheetTitle>
              <SheetDescription>
                {detail.accountLabel} · {tx.description}
              </SheetDescription>
            </SheetHeader>

            {detail.transfers.length > 0 && canWrite && (
              <section className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
                <h3 className="mb-1 font-medium">{t("banking.panel.transfer")}</h3>
                {detail.transfers.map((p) => (
                  <div key={p.to.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div>
                        {t("banking.panel.transferReason", {
                          from: money(p.from.amount, p.from.currency),
                          to: money(p.to.amount, p.to.currency),
                          implied: p.implied.replace(/0+$/, "").replace(/\.$/, ""),
                        })}
                      </div>
                      {p.ecb && (
                        <div className="text-xs text-muted-foreground">
                          {t("banking.panel.transferEcb", {
                            ecb: p.ecb.replace(/0+$/, "").replace(/\.$/, ""),
                            deviation: p.deviationPercent ?? "0",
                          })}
                          {p.hints.length ? ` · ${p.hints.join(", ")}` : ""}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void acceptPair(p.from.id, p.to.id)}
                      disabled={accepting}
                      data-testid="accept-transfer"
                    >
                      {t("banking.panel.acceptTransfer")}
                    </Button>
                  </div>
                ))}
              </section>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">{t("banking.panel.journal")}</h3>
                {canWrite && detail.entry && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRuleOpen(true)}
                    data-testid="create-rule"
                  >
                    {t("banking.panel.createRule")}
                  </Button>
                )}
              </div>
              {detail.entry ? (
                <>
                  <p className="mb-2 text-xs text-muted-foreground tabular-nums">
                    {t("banking.panel.base", {
                      base: formatCurrency(detail.entry.amountBase, "SEK"),
                      rate: detail.entry.rate,
                      source: t(`journal.rateSource.${detail.entry.rateSource}`),
                    })}
                    {detail.entry.bankImplicitRate
                      ? ` · ${t("banking.panel.implicitRate", { rate: detail.entry.bankImplicitRate.replace(/0+$/, "").replace(/\.$/, "") })}`
                      : ""}
                  </p>
                  <CategoriseForm
                    entry={detail.entry}
                    categories={categories}
                    partners={partners}
                    canWrite={canWrite}
                    onSaved={(e) =>
                      entrySaved({
                        ...e,
                        createdAt: String(e.createdAt),
                        updatedAt: String(e.updatedAt),
                      })
                    }
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </section>

            {/* what this row could justify — the scored candidates, "Link to…" (specs/linking) */}
            {detail.state !== "no_document" && (
              <SuggestionsSection
                target={{ bankTransactionId: tx.id }}
                canWrite={canWrite}
                onLinked={changed}
                refreshKey={version}
              />
            )}

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("banking.panel.links")}</h3>
              <LinksList
                self={{ type: "bank_transaction", id: tx.id }}
                links={detail.links}
                canWrite={canWrite}
                fallbackCurrency={tx.currency}
                onChanged={changed}
              />
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("banking.panel.raw")}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {raw.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v ?? "—"}</dd>
                  </div>
                ))}
                <dt className="text-muted-foreground">{t("banking.col.counterparty")}</dt>
                <dd className="font-mono text-xs">{tx.counterpartyKey}</dd>
                {detail.import && (
                  <>
                    <dt className="text-muted-foreground">{t("banking.panel.import")}</dt>
                    <dd>{detail.import.fileName}</dd>
                  </>
                )}
              </dl>
            </section>

            {canWrite && detail.entry && (
              <RuleDialog
                open={ruleOpen}
                onOpenChange={setRuleOpen}
                fromTransactionId={tx.id}
                initial={{
                  name: tx.counterpartyKey,
                  matchPattern: tx.counterpartyKey,
                  basCode: detail.entry.basCode,
                  partnerId: detail.entry.partnerId,
                  noDocumentNeeded: detail.entry.noDocumentNeeded,
                }}
                categories={categories}
                partners={partners}
                onSaved={changed}
              />
            )}
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>…</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
