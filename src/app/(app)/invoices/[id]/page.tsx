import { notFound } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { formatMoney } from "@/kernel/money/format-money";
import { EntityPage } from "@/kernel/ui/shell/page";
import { Tag } from "@/kernel/ui/tags";
import { declaredOn } from "@/modules/exports";
import { relatedDocuments, resolveSheetContext } from "@/modules/invoices";
import {
  InvoiceActions,
  InvoiceDetails,
  InvoiceEditor,
  InvoiceSheet,
  InvoiceStateLabel,
  toSheetDocument,
} from "@/modules/invoices/ui";
import { getPartner } from "@/modules/partners";
import { getUserPreferences } from "@/modules/settings";

// The document page: the sheet in edit mode while draft (autosave), the print mode once issued, the
// lifecycle actions in the title row (D7), the side panel of sections beside it (D40, F71). The PDF is the
// stored document, never re-rendered — the sheet keeps the printed format; everything around it formatMoney.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireCaller({ action: "read", subject: "invoice" });
  const today = createClock().today();
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const ctx = await resolveSheetContext(tx, auth, id, today);
    if (!ctx) return null;
    const related = await relatedDocuments(tx, id);
    const partner = await getPartner(tx, ctx.invoice.partnerId);
    const declared = await declaredOn(
      tx,
      ctx.invoice.declarationPeriod,
      ctx.invoice.vatRegistrationId,
    );
    const prefs = await getUserPreferences(tx, auth);
    return { ctx, related, partner: partner.data ?? null, declared, prefs: prefs.data };
  });
  if (!data) notFound();
  const { ctx, related, partner, declared, prefs } = data;
  const inv = ctx.invoice;
  const canWrite = can(auth, "update", "invoice");
  const t = translator(await requestLocale(prefs?.locale));
  const docType = t(`invoices.type.${inv.type}`);

  return (
    <EntityPage
      title={
        inv.number ? (
          <span className="font-mono">{inv.number}</span>
        ) : (
          `${docType} · ${t("invoices.state.draft")}`
        )
      }
      tags={
        <>
          <InvoiceStateLabel state={inv.state} testId="invoice-state" className="mr-1" />
          {inv.number && <Tag>{docType}</Tag>}
          <Tag>{inv.currency}</Tag>
        </>
      }
      meta={`${partner?.name ?? ""} · ${formatMoney(inv.totalAmount, inv.currency)}`}
      actions={
        <InvoiceActions
          id={inv.id}
          type={inv.type}
          status={inv.status}
          state={inv.state}
          numberHint={ctx.numberHint}
          pdfDocumentId={inv.pdfDocumentId}
          canWrite={canWrite}
        />
      }
    >
      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 rounded-lg border bg-app p-4">
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
        <aside className="w-full shrink-0 xl:w-[380px] xl:border-l xl:pl-4">
          <InvoiceDetails
            invoice={{
              id: inv.id,
              type: inv.type,
              status: inv.status,
              state: inv.state,
              partnerName: partner?.name ?? null,
              issueDate: inv.issueDate,
              dueDate: inv.dueDate,
              periodLabel: inv.periodLabel,
              currency: inv.currency,
              totalAmount: inv.totalAmount,
              allocated: inv.allocated,
              remaining: inv.remaining,
              credited: inv.credited,
              baseCurrency: inv.baseCurrency,
              totalBase: inv.totalBase,
              rateToBase: inv.rateToBase,
              rateSource: inv.rateSource,
              rateDate: inv.rateDate,
              declarationPeriod: inv.declarationPeriod,
              internalNote: inv.internalNote,
            }}
            related={related}
            declared={declared}
            canWrite={canWrite}
          />
        </aside>
      </div>
    </EntityPage>
  );
}
