import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { EntityPage } from "@/kernel/ui/shell/page";
import { relatedDocuments, resolveSheetContext } from "@/modules/invoices";
import {
  InvoiceActions,
  InvoiceEditor,
  InvoiceLinks,
  InvoiceSheet,
  toSheetDocument,
} from "@/modules/invoices/ui";
import { getPartner } from "@/modules/partners";

// The document page: the sheet in edit mode while draft (autosave), the print mode once issued, the
// lifecycle actions above it (D7). The PDF is the stored document, never re-rendered.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireCaller({ action: "read", subject: "invoice" });
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const ctx = await resolveSheetContext(tx, auth, id, today);
    if (!ctx) return null;
    const [related, partner] = await Promise.all([
      relatedDocuments(tx, id),
      getPartner(tx, ctx.invoice.partnerId),
    ]);
    return { ctx, related, partner: partner.data ?? null };
  });
  if (!data) notFound();
  const { ctx, related, partner } = data;
  const inv = ctx.invoice;
  const canWrite = can(auth, "update", "invoice");
  const title =
    inv.number ??
    `${inv.type === "quote" ? "Quote" : inv.type === "credit_note" ? "Credit note" : "Invoice"} (draft)`;

  return (
    <EntityPage
      title={title}
      meta={`${partner?.name ?? ""} · ${inv.currency} ${inv.totalAmount}${inv.declarationPeriod ? ` · ${inv.declarationPeriod}` : ""}`}
      back={<Link href="/invoices">← Invoices</Link>}
      actions={
        <InvoiceActions
          id={inv.id}
          type={inv.type}
          status={inv.status}
          state={inv.state}
          number={inv.number}
          numberHint={ctx.numberHint}
          pdfDocumentId={inv.pdfDocumentId}
          canWrite={canWrite}
        />
      }
    >
      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 rounded-lg border bg-neutral-100 p-4 dark:bg-neutral-900">
          {inv.status === "draft" && canWrite ? (
            <InvoiceEditor
              invoice={{
                ...inv,
                issuedAt: inv.issuedAt?.toISOString() ?? null,
                sentAt: inv.sentAt?.toISOString() ?? null,
                decidedAt: inv.decidedAt?.toISOString() ?? null,
                createdAt: inv.createdAt.toISOString(),
                updatedAt: inv.updatedAt.toISOString(),
              }}
              parties={ctx.parties}
              numberHint={ctx.numberHint}
              relatedNumber={ctx.relatedNumber}
              registrations={ctx.registrations}
              partnerForVat={{
                address: partner?.address ?? null,
                vatNumber: partner?.vatNumber ?? null,
              }}
            />
          ) : (
            <InvoiceSheet
              mode="print"
              doc={toSheetDocument(inv, {
                parties: ctx.parties,
                treatment: ctx.treatment,
                relatedNumber: ctx.relatedNumber,
              })}
            />
          )}
        </div>
        <aside className="w-full shrink-0 space-y-3 text-sm xl:w-72">
          {inv.status !== "draft" && (
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground">Payment</div>
              <div data-testid="invoice-payment">
                Paid {inv.allocated} · Remaining{" "}
                <span data-testid="invoice-remaining">{inv.remaining}</span>
              </div>
              {Number(inv.credited) > 0 && <div>Credited {inv.credited}</div>}
              {inv.totalBase && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {inv.baseCurrency} {inv.totalBase} at {inv.rateToBase} ({inv.rateSource},{" "}
                  {inv.rateDate})
                </div>
              )}
            </div>
          )}
          {inv.status !== "draft" && inv.type !== "quote" && (
            <InvoiceLinks invoiceId={inv.id} currency={inv.currency} canWrite={canWrite} />
          )}
          {related.length > 0 && (
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground">Related documents</div>
              <ul>
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/invoices/${r.id}`} className="hover:underline">
                      {r.number ?? `${r.type} (draft)`}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      {r.status} · {r.totalAmount}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inv.internalNote && (
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground">Internal note</div>
              <div className="whitespace-pre-wrap">{inv.internalNote}</div>
            </div>
          )}
        </aside>
      </div>
    </EntityPage>
  );
}
