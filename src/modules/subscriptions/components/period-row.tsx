"use client";

// One period of the timeline (F94 US2, US3, US4): the expected date and price, the derived state and its marks, the
// entity it became (a link), what was found for it — bank rows and receipts / bills with how far off they are — and
// the owner's actions: *Confirm* (with the picked offers), *Assign a row… / Assign a receipt…*, *Detach*.
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import type { Becomes, PeriodView } from "../types";
import { PeriodStateLabel } from "./period-state";

const entityHref = (type: Becomes, id: string) =>
  type === "expense" ? `/expenses?open=${id}` : `/supplier-invoices?open=${id}`;

export function PeriodRow({
  period,
  becomes,
  canWrite,
  onConfirm,
  onAssign,
  onDetach,
}: {
  period: PeriodView;
  becomes: Becomes;
  canWrite: boolean;
  onConfirm: (pick: { bankTransactionId?: string; documentId?: string }) => void;
  onAssign: (kind: "row" | "document") => void;
  onDetach: (entity: { type: Becomes; id: string }) => void;
}) {
  const t = useT();
  const firstRow = period.rows.find((r) => !r.ambiguous) ?? period.rows[0];
  const firstDoc = period.documents.find((d) => !d.ambiguous) ?? period.documents[0];
  const [rowId, setRowId] = useState<string | undefined>(firstRow?.rowId);
  const [docId, setDocId] = useState<string | undefined>(firstDoc?.documentId);
  const entity = period.entities[0];
  const offers = period.rows.length + period.documents.length;
  const quiet = period.state === "upcoming" || period.state === "skipped";
  const canAssignRow =
    becomes === "expense" && (!entity || (entity.needsPayment && !entity.paid)) && !quiet;
  const canAssignDoc = (!entity || !entity.hasDocument) && period.state !== "skipped";

  return (
    <li className="grid gap-1.5 py-2" data-testid={`period-${period.date}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">{period.date}</span>
        {period.price && (
          <span className="tabular-nums text-muted-foreground">
            {formatMoney(period.price.amount, period.price.currency)}
          </span>
        )}
        <PeriodStateLabel state={period.state} marks={period.marks} testId="period-state" />
      </div>
      {period.entities.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-2 pl-1 text-[13px]">
          <Link href={entityHref(e.type, e.id)} className="hover:underline">
            <CodeChip>{e.key}</CodeChip>
          </Link>
          <span className="tabular-nums">{formatMoney(e.amount, e.currency)}</span>
          <span className="text-muted-foreground">
            {e.hasDocument
              ? t("subscriptions.period.hasDocument")
              : t("subscriptions.period.noDocument")}
          </span>
          {canWrite && (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0"
              onClick={() => onDetach({ type: e.type, id: e.id })}
            >
              {t("subscriptions.period.detach")}
            </Button>
          )}
        </div>
      ))}
      {period.rows.length > 0 && (
        <fieldset className="grid gap-0.5 pl-1 text-[13px]">
          <legend className="text-xs text-muted-foreground">
            {t("subscriptions.period.rows")}
          </legend>
          {period.rows.map((r) => (
            <label key={r.rowId} className="flex flex-wrap items-center gap-2">
              {canWrite && period.rows.length > 1 && (
                <input
                  type="radio"
                  name={`row-${period.date}`}
                  checked={rowId === r.rowId}
                  onChange={() => setRowId(r.rowId)}
                />
              )}
              <span className="tabular-nums">{r.bookingDate}</span>
              <span className="tabular-nums">{formatMoney(r.amount, r.currency)}</span>
              <span className="truncate text-muted-foreground">{r.description}</span>
              {r.diffPct !== null && r.diffPct !== "0.00" && (
                <span className="text-muted-foreground">
                  {t("subscriptions.period.diff", { pct: r.diffPct })}
                </span>
              )}
              {r.crossCurrency && <Tag>{t("subscriptions.period.cross")}</Tag>}
              {r.ambiguous && <Tag>{t("subscriptions.period.ambiguous")}</Tag>}
              {r.hints.includes("rule_no_document") && (
                <span className="text-xs text-state-attention">
                  {t("subscriptions.period.hintRule")}
                </span>
              )}
              {r.hints.includes("category_differs") && (
                <span className="text-xs text-muted-foreground">
                  {t("subscriptions.period.hintCategory")}
                </span>
              )}
            </label>
          ))}
        </fieldset>
      )}
      {period.documents.length > 0 && (
        <fieldset className="grid gap-0.5 pl-1 text-[13px]">
          <legend className="text-xs text-muted-foreground">
            {t("subscriptions.period.documents")}
          </legend>
          {period.documents.map((d) => (
            <label key={d.documentId} className="flex flex-wrap items-center gap-2">
              {canWrite && period.documents.length > 1 && (
                <input
                  type="radio"
                  name={`doc-${period.date}`}
                  checked={docId === d.documentId}
                  onChange={() => setDocId(d.documentId)}
                />
              )}
              <Link
                href={`/documents/${d.documentId}`}
                className="font-mono text-xs hover:underline"
              >
                {d.businessKey}
              </Link>
              <span className="tabular-nums">{d.date}</span>
              {d.total && d.currency && (
                <span className="tabular-nums">{formatMoney(d.total, d.currency)}</span>
              )}
              {d.certain && <Tag>{t("subscriptions.period.certain")}</Tag>}
              {d.amountUnknown && (
                <span className="text-xs text-muted-foreground">
                  {t("subscriptions.period.amountUnknown")}
                </span>
              )}
              {d.ambiguous && <Tag>{t("subscriptions.period.ambiguous")}</Tag>}
            </label>
          ))}
        </fieldset>
      )}
      {canWrite && !quiet && (
        <div className="flex flex-wrap gap-2 pl-1">
          {offers > 0 && (
            <Button
              size="sm"
              onClick={() =>
                onConfirm({
                  bankTransactionId: period.rows.length ? rowId : undefined,
                  documentId: period.documents.length ? docId : undefined,
                })
              }
              data-testid="period-confirm"
            >
              {t("subscriptions.period.confirm")}
            </Button>
          )}
          {canAssignRow && (
            <Button size="sm" variant="outline" onClick={() => onAssign("row")}>
              {t("subscriptions.period.assignRow")}
            </Button>
          )}
          {canAssignDoc && (
            <Button size="sm" variant="outline" onClick={() => onAssign("document")}>
              {t("subscriptions.period.assignDocument")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
