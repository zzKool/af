"use client";

// Make it… (specs/documents US1): under the review form the owner says what the document is — an expense, a
// supplier invoice (the modules' own dialogs, pre-filled from the OCR facts as corrected, the document
// pre-selected) or nothing to create (*Just file it* = mark reviewed). Once the document became something the
// section shows what, with a link. The dialogs stay the modules'; this is the composition.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { OcrExtractedData } from "@/kernel/ocr/ocr";
import { markDocumentReviewedAction } from "@/modules/documents/documents.actions";
import type {
  CategoryOption as ExpenseCategoryOption,
  GroupOption as ExpenseGroupOption,
  SourceOption,
} from "@/modules/expenses/ui";
import { type ExpenseInitial, NewExpenseDialog } from "@/modules/expenses/ui";
import type {
  RegistrationOption,
  CategoryOption as SiCategoryOption,
  GroupOption as SiGroupOption,
  SupplierOption,
} from "@/modules/supplier-invoices/ui";
import {
  NewSupplierInvoiceDialog,
  type SupplierInvoiceInitial,
} from "@/modules/supplier-invoices/ui";

export type MakeItOptions = {
  expense: {
    groups: ExpenseGroupOption[];
    categories: ExpenseCategoryOption[];
    sources: SourceOption[];
  };
  supplier: {
    groups: SiGroupOption[];
    categories: SiCategoryOption[];
    suppliers: SupplierOption[];
    registrations: RegistrationOption[];
  };
};

/** What the document became (the `created_from` link), as the page reads it through the linking module. */
export type Became = { type: "expense" | "supplier_invoice"; id: string; label: string | null };

const isoDay = (s: string | undefined) =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
const money = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n.toFixed(2) : undefined;

/** The OCR facts as corrected → the two dialogs' initial values (pure, exported for the tests). */
export function initialFromFacts(
  documentId: string,
  documentKey: string,
  facts: Partial<OcrExtractedData>,
): { expense: ExpenseInitial; supplier: SupplierInvoiceInitial } {
  const vendor = facts.vendorName ?? facts.merchantName ?? null;
  const date = isoDay(facts.invoiceDate) ?? isoDay(facts.transactionDate);
  const currency = facts.currency?.toUpperCase();
  return {
    expense: {
      date,
      description: vendor,
      amount: money(facts.invoiceTotal),
      currency,
      vatAmount: money(facts.totalTax),
      documentId,
      documentKey,
    },
    supplier: {
      vendor: {
        name: vendor,
        vatNumber: facts.vendorTaxId ?? null,
        address: facts.vendorAddress ?? null,
      },
      invoiceNumber: facts.invoiceNumber ?? null,
      invoiceDate: date,
      dueDate: isoDay(facts.dueDate),
      currency,
      amountNet: money(facts.subtotal),
      vatAmount: money(facts.totalTax),
      amountTotal: money(facts.invoiceTotal),
      documentId,
      documentKey,
    },
  };
}

export function becameHref(b: Became): string {
  return b.type === "expense" ? `/expenses?open=${b.id}` : `/supplier-invoices?open=${b.id}`;
}

export function MakeItSection({
  documentId,
  documentKey,
  facts,
  reviewedAt,
  became,
  options,
  financial = true,
}: {
  documentId: string;
  documentKey: string;
  facts: Partial<OcrExtractedData>;
  reviewedAt: Date | null;
  became: Became | null;
  options: MakeItOptions | null;
  /** a relationship document (contract, NDA) becomes nothing: only *Just file it* is offered */
  financial?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [dialog, setDialog] = useState<"expense" | "supplier" | null>(null);
  const { executeAsync: markReviewed, isPending: filing } = useAction(markDocumentReviewedAction);

  if (became) {
    return (
      <div className="rounded-lg border p-4 text-sm" data-testid="document-became">
        <span className="font-medium">
          {t(
            became.type === "expense"
              ? "documents.makeIt.becameExpense"
              : "documents.makeIt.becameSupplierInvoice",
            { key: became.label ?? "" },
          )}
        </span>
        <Button
          variant="link"
          size="sm"
          className="ml-2 h-auto p-0"
          onClick={() => router.push(becameHref(became))}
        >
          {t("documents.makeIt.open")} →
        </Button>
      </div>
    );
  }
  if (!options) return null;

  const initial = initialFromFacts(documentId, documentKey, facts);

  async function justFile() {
    const r = await markReviewed({ documentId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("documents.makeIt.filed"));
    router.refresh();
  }

  return (
    <div className="rounded-lg border p-4" data-testid="make-it">
      <div className="text-sm font-medium">{t("documents.makeIt.title")}</div>
      <p className="mt-1 text-xs text-muted-foreground">{t("documents.makeIt.hint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {financial && (
          <>
            <Button size="sm" onClick={() => setDialog("expense")} data-testid="make-it-expense">
              {t("documents.makeIt.expense")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDialog("supplier")}
              data-testid="make-it-supplier-invoice"
            >
              {t("documents.makeIt.supplierInvoice")}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void justFile()}
          disabled={filing || reviewedAt != null}
          title={t("documents.makeIt.justFileHint")}
          data-testid="make-it-file"
        >
          {reviewedAt ? t("documents.makeIt.filed") : t("documents.makeIt.justFile")}
        </Button>
      </div>
      <NewExpenseDialog
        open={dialog === "expense"}
        onOpenChange={(o) => setDialog(o ? "expense" : null)}
        groups={options.expense.groups}
        categories={options.expense.categories}
        sources={options.expense.sources}
        documents={[]}
        initial={initial.expense}
        onCreated={() => router.refresh()}
      />
      <NewSupplierInvoiceDialog
        open={dialog === "supplier"}
        onOpenChange={(o) => setDialog(o ? "supplier" : null)}
        groups={options.supplier.groups}
        categories={options.supplier.categories}
        suppliers={options.supplier.suppliers}
        registrations={options.supplier.registrations}
        documents={[]}
        initial={initial.supplier}
        onCreated={() => router.refresh()}
      />
    </div>
  );
}
