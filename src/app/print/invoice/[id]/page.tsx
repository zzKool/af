// The print mode of the sheet, served to Chromium by kernel/pdf (docs/pdf.md). Token-authenticated: the
// renderer mints a 120 s token bound to this path; anything else 404s. Server component, no client JS.
import { notFound } from "next/navigation";
import { requirePrintCaller } from "@/kernel/auth/print-caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { resolveSheetContext } from "@/modules/invoices";
import { InvoiceSheet, toSheetDocument } from "@/modules/invoices/ui";

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PrintInvoicePage({ params, searchParams }: Params) {
  const { id } = await params;
  const caller = await requirePrintCaller(searchParams, `/print/invoice/${id}`);
  const ctx = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
    resolveSheetContext(tx, caller, id),
  );
  if (!ctx) notFound();
  const doc = toSheetDocument(ctx.invoice, {
    parties: ctx.parties,
    treatment: ctx.treatment,
    relatedNumber: ctx.relatedNumber,
  });
  return (
    <main className="bg-white">
      <InvoiceSheet mode="print" doc={doc} />
    </main>
  );
}
