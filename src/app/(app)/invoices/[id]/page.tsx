import { notFound } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { formatCurrency } from "@/kernel/money/format-currency";
import { formatMoney } from "@/kernel/money/format-money";
import type { Currency } from "@/kernel/nav/constants";
import { EntityPage } from "@/kernel/ui/shell/page";
import { Tag } from "@/kernel/ui/tags";
import { declaredOn } from "@/modules/exports";
import {
  baseFigure,
  relatedDocuments,
  reminderDue,
  resolveSheetContext,
  studioFacts,
} from "@/modules/invoices";
import {
  InvoiceActions,
  InvoiceDetails,
  InvoiceEditor,
  InvoiceFigures,
  InvoiceSheet,
  InvoiceStateLabel,
  InvoiceStudio,
  ReminderCard,
  ReminderToggle,
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
    const facts = ctx.invoice.status === "draft" ? await studioFacts(tx, ctx, today) : null;
    return { ctx, related, partner: partner.data ?? null, declared, prefs: prefs.data, facts };
  });
  if (!data) notFound();
  const { ctx, related, partner, declared, prefs, facts } = data;
  const inv = ctx.invoice;
  const canWrite = can(auth, "update", "invoice");
  const t = translator(await requestLocale(prefs?.locale));
  const docType = t(`invoices.type.${inv.type}`);
  // F143: the reminder drafted when late — an issued invoice, three days past its due date, still open
  const owing = inv.type === "invoice" && inv.number && Number(inv.remaining) > 0;
  // F169: drafted only while the invoice's switch is on (on by default)
  const reminder =
    owing && inv.number && inv.remindWhenLate && reminderDue(inv.dueDate, today, true)
      ? {
          number: inv.number,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate as string,
          open: `${inv.currency} ${formatCurrency(inv.remaining, inv.currency as Currency)}`,
          clientName: ctx.parties.partner.name,
          companyName: ctx.parties.tenant.name,
          ownerName: null,
        }
      : null;

  const studio = inv.status === "draft" && canWrite && facts;

  return (
    <EntityPage
      ground
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
        // F160: a draft's actions sit in the studio's bar at the bottom
        studio ? undefined : (
          <InvoiceActions
            id={inv.id}
            type={inv.type}
            status={inv.status}
            state={inv.state}
            numberHint={ctx.numberHint}
            pdfDocumentId={inv.pdfDocumentId}
            canWrite={canWrite}
          />
        )
      }
    >
      {studio ? (
        <InvoiceStudio
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
          partnerName={partner?.name ?? ""}
          facts={facts}
          today={today}
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
          details={
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
                allocatedBase: inv.allocatedBase,
                fxDifference: inv.fxDifference,
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
          }
        />
      ) : (
        <div className="flex flex-col gap-[18px]">
          {/* F163: the figures of an issued invoice — total, paid, open, due — as the boards' KPI tiles */}
          {inv.type === "invoice" && (
            <InvoiceFigures
              total={inv.totalAmount}
              allocated={inv.allocated}
              remaining={inv.remaining}
              currency={inv.currency}
              dueDate={inv.dueDate}
              state={inv.state}
              today={today}
              base={baseFigure(inv, inv.totalAmount, null)}
            />
          )}
          <div className="flex flex-col gap-[18px] xl:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
              {/* F169: the reminder's switch, while something is owed (an issued invoice still open) */}
              {owing && canWrite && (
                <div className="pulse-card px-4 py-2.5">
                  <ReminderToggle id={inv.id} on={inv.remindWhenLate} />
                </div>
              )}
              {reminder && (
                <ReminderCard
                  facts={reminder}
                  language={inv.language}
                  today={today}
                  email={ctx.parties.partner.email}
                />
              )}
              <div className="pulse-card-2 p-4">
                <InvoiceSheet
                  mode="print"
                  doc={toSheetDocument(inv, {
                    parties: ctx.parties,
                    treatment: ctx.treatment,
                    relatedNumber: ctx.relatedNumber,
                  })}
                />
              </div>
            </div>
            <aside className="w-full shrink-0 pulse-card p-4 xl:w-[380px]">
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
                  allocatedBase: inv.allocatedBase,
                  fxDifference: inv.fxDifference,
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
        </div>
      )}
    </EntityPage>
  );
}
