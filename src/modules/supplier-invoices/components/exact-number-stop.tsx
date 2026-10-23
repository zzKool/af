"use client";

// The supplier's invoice number is already recorded (D35): a refusal, not a warning — no note, no *Create anyway*,
// a link to the invoice that holds the number. The hash and fuzzy matches stay with expenses' DuplicatePanel.
import { Ban } from "lucide-react";
import Link from "next/link";
import { useT } from "@/kernel/i18n/use-t";
import type { DuplicateMatch } from "@/modules/expenses";

/** The matches D35 refuses outright: same supplier + normalised number. */
export function exactMatches(matches: readonly DuplicateMatch[]): DuplicateMatch[] {
  return matches.filter((m) => m.kind === "exact");
}

export function ExactNumberStop({ matches }: { matches: readonly DuplicateMatch[] }) {
  const t = useT();
  if (matches.length === 0) return null;
  return (
    <div
      className="sm:col-span-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
      data-testid="exact-number-stop"
      role="alert"
    >
      <div className="flex items-center gap-2 font-medium">
        <Ban className="size-4 text-destructive" />
        {t("supplierInvoices.form.numberTaken")}
      </div>
      <ul className="mt-1 space-y-0.5">
        {matches.map((m) => (
          <li key={m.entityId} className="flex flex-wrap items-center gap-x-2">
            <span>
              {t("supplierInvoices.form.numberTakenBy", {
                n: String(m.reason.params.n ?? ""),
                key: m.entityKey,
              })}
            </span>
            <Link
              href={`/supplier-invoices?open=${m.entityId}`}
              className="underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              data-testid="exact-number-open"
            >
              {t("documents.duplicate.panel.open", { key: m.entityKey })}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("supplierInvoices.form.numberTakenHint")}
      </p>
    </div>
  );
}
