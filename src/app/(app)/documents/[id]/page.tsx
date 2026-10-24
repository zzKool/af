import { notFound, redirect } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { getDocumentForReviewAction } from "@/modules/documents";
import type { Became, CompanyIdentity, MakeItOptions } from "@/modules/documents/ui";
import { DocumentReviewClient } from "@/modules/documents/ui";
import { expensePageOptions } from "@/modules/expenses";
import { linksWithLabels } from "@/modules/linking";
import { getTenantProfile, getVatRegistrations } from "@/modules/settings";
import { supplierInvoicePageOptions } from "@/modules/supplier-invoices";

// The review page composes what the document became (the linking module's read), the company identity an invoice
// is checked against (D53, settings' read) and, for the owner, the two creation dialogs' option lists so *Make it…*
// (specs/documents US1) opens them pre-filled.
export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireCaller({ action: "read", subject: "financial_document" });
  const result = await getDocumentForReviewAction({ documentId: id });

  if (result?.data?.error?.code === "NOT_FOUND") notFound();
  if (result?.data?.error?.code === "FORBIDDEN") redirect("/documents");
  if (result?.data?.error || !result?.data?.data) redirect("/documents");
  const data = result.data.data;
  const canMake = !data.readOnly && data.status !== "generated";

  const { became, makeItOptions, company } = await withTenantTransaction(
    prisma,
    auth.tenantId,
    async (tx) => {
      const links = await linksWithLabels(tx, { type: "document", id });
      const origin = links.find((l) => l.kind === "created_from");
      const became: Became | null =
        origin && (origin.from.type === "expense" || origin.from.type === "supplier_invoice")
          ? { type: origin.from.type, id: origin.from.id, label: origin.otherLabel }
          : null;
      let makeItOptions: MakeItOptions | null = null;
      if (canMake && !became) {
        const expense = await expensePageOptions(tx, auth, {
          documents: false,
          transactions: false,
        });
        const supplier = await supplierInvoicePageOptions(tx, auth, { documents: false });
        makeItOptions = {
          expense: {
            groups: expense.groups,
            categories: expense.categories,
            sources: expense.sources,
          },
          supplier: {
            groups: supplier.groups,
            categories: supplier.categories,
            suppliers: supplier.suppliers,
            registrations: supplier.registrations,
          },
        };
      }
      // who an invoice should be billed to (D53): the company's name, org number and VAT numbers
      const profile = await getTenantProfile(tx, auth);
      const registrations = await getVatRegistrations(tx, auth);
      const company: CompanyIdentity | null = profile.data
        ? {
            name: profile.data.name,
            orgNumber: profile.data.orgNumber,
            vatNumbers: (registrations.data ?? []).map((r) => r.vatNumber),
          }
        : null;
      return { became, makeItOptions, company };
    },
  );

  return (
    <DocumentReviewClient
      data={data}
      became={became}
      makeItOptions={makeItOptions}
      company={company}
    />
  );
}
