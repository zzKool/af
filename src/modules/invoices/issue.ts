// Issue: validate, convert to the base currency, snapshot, number, lock — one transaction.
import { Prisma } from "@/generated/prisma/browser";
import type { Invoice, InvoiceLine } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import * as banking from "@/modules/banking";
import * as numbering from "@/modules/numbering";
import * as partners from "@/modules/partners";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import { registrationById } from "./defaults";
import { declarationPeriodFor } from "./derive";
import { load, toDate, toInvoiceDto, withLines } from "./dto";
import { invalid, notFound, parseError, violation } from "./errors";
import { type IssueInput, issueSchema } from "./schemas";
import { baseTotals } from "./totals";
import type { InvoiceDto, InvoiceType, PrintedParties } from "./types";

const D = Prisma.Decimal;

// --- writes: issue ---

function seriesFor(type: InvoiceType, shortCode: string, issueDate: string): string {
  if (type === "quote") return numbering.quoteSeries(shortCode, issueDate);
  if (type === "credit_note") return numbering.creditNoteSeries(shortCode, issueDate);
  return numbering.invoiceSeries(shortCode, issueDate);
}

/**
 * Issue a draft: validate, take the number (row-locked, same transaction), convert to the base currency with
 * the ECB rate of the issue date, derive the declaration period, snapshot the printed parties, lock.
 * The PDF is rendered afterwards by the render job (part 2) — never inside this transaction.
 */
export async function issue(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  now: Date,
  input: IssueInput,
): Promise<ServiceResult<InvoiceDto>> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const row = await load(tx, parsed.data.id);
  if (!row) return { error: notFound("Invoice", parsed.data.id) };
  if (row.status !== "draft") return { error: violation(`${row.number} is already issued`) };
  const before = toInvoiceDto(row);
  const issueDate = parsed.data.issueDate ?? before.issueDate;

  // validations that only matter at issue
  if (row.lines.length === 0) return { error: invalid("At least one line is required") };
  if (row.lines.some((l) => l.description.trim() === ""))
    return { error: invalid("Every line needs a description") };
  if (before.dueDate && before.dueDate < issueDate)
    return { error: invalid("Due date must be on or after the issue date") };
  const partner = await partners.getPartner(tx, row.partnerId);
  if (!partner.data) return { error: notFound("Partner", row.partnerId) };
  if (!partner.data.shortCode)
    return {
      error: violation(`${partner.data.name} needs a short code (the invoice series)`, {
        partnerId: partner.data.id,
      }),
    };
  if (row.type === "credit_note") {
    const check = await creditLimit(tx, row);
    if (check) return { error: check };
  }

  // base currency (D3/D4) — never a silent null
  const base = await rates.rateToBase(tx, issueDate, row.currency, row.baseCurrency);
  if (!base)
    return {
      error: violation(
        `No exchange rate ${row.currency}/${row.baseCurrency} for ${issueDate} — run the ECB sync`,
      ),
    };
  // subtotal after the header discount, VAT, total = their sum (F57: reconciles with a discount too)
  const based = baseTotals(
    {
      subtotal: row.subtotal.toFixed(2),
      discountAmount: row.discountAmount.toFixed(2),
      vat: row.vatAmount.toFixed(2),
    },
    base.rate.toString(),
  );

  // declaration period (D12/D23): CH-registration invoices and credit notes
  const registration = await registrationById(tx, caller, row.vatRegistrationId);
  const declarationPeriod =
    registration?.country === "CH" && row.type !== "quote"
      ? declarationPeriodFor("CH", issueDate)
      : null;

  // printed parties snapshot
  const profile = await settings.getTenantProfile(tx, caller);
  const accounts = await banking.getBankAccounts(tx, caller);
  const bank =
    accounts.data?.find((a) => a.currency === row.currency) ??
    accounts.data?.find((a) => a.currency === row.baseCurrency) ??
    null;
  const printedParties: PrintedParties = {
    tenant: {
      name: profile.data?.name ?? "",
      orgNumber: profile.data?.orgNumber ?? null,
      address: profile.data?.address ?? null,
      email: profile.data?.email ?? null,
      website: profile.data?.website ?? null,
      logoUrl: profile.data?.logoUrl ?? null,
      vatNumber: registration?.vatNumber ?? null,
      vatCountry: registration?.country ?? null,
    },
    partner: {
      name: partner.data.name,
      address: partner.data.address,
      vatNumber: partner.data.vatNumber,
      orgNumber: partner.data.orgNumber,
      email: partner.data.email,
    },
    bank: bank
      ? {
          bankName: bank.bankFormat?.bankName ?? null,
          accountHolder: profile.data?.name ?? null,
          iban: bank.iban,
          bic: bank.bic,
          accountNumber: bank.accountNumber,
          currency: bank.currency,
        }
      : null,
  };

  // the number — last, after everything that can still fail (numbering spec R1)
  const series = seriesFor(row.type, partner.data.shortCode, issueDate);
  const seq = await numbering.nextInSeries(tx, caller, series);
  const number = numbering.formatSeriesNumber(series, seq);

  const updated = await tx.invoice.update({
    where: { id: row.id },
    data: {
      status: "issued",
      number,
      issueDate: toDate(issueDate),
      issuedAt: now,
      rateToBase: base.rate,
      rateSource: base.source,
      rateDate: toDate(base.rateDate),
      subtotalBase: based.subtotalBase,
      vatBase: based.vatBase,
      totalBase: based.totalBase,
      declarationPeriod,
      printedParties: printedParties as unknown as Prisma.InputJsonValue,
    },
    include: withLines,
  });
  const dto = toInvoiceDto(updated);
  await audit.log({
    action: "update",
    entityType: "invoice",
    entityId: row.id,
    oldData: toAuditData({ ...before, event: "issue" }),
    newData: toAuditData({ ...dto, event: "issue" }),
  });
  return { data: dto };
}

/** Σ issued credit notes of the original + this one must not exceed the original's total. */
async function creditLimit(
  tx: TransactionClient,
  creditNote: Invoice & { lines: InvoiceLine[] },
): Promise<AppError | null> {
  if (!creditNote.relatedInvoiceId) return violation("A credit note needs its original invoice");
  const original = await tx.invoice.findUnique({ where: { id: creditNote.relatedInvoiceId } });
  if (!original) return notFound("Original invoice", creditNote.relatedInvoiceId);
  if (original.status === "draft") return violation("The original invoice is not issued");
  const issued = await tx.invoice.aggregate({
    where: { relatedInvoiceId: original.id, type: "credit_note", status: { not: "draft" } },
    _sum: { totalAmount: true },
  });
  const already = issued._sum.totalAmount ?? new D(0);
  if (already.add(creditNote.totalAmount).gt(original.totalAmount)) {
    return violation(
      `Credit notes would exceed the original: ${already.toFixed(2)} already credited + ${creditNote.totalAmount.toFixed(2)} > ${original.totalAmount.toFixed(2)} ${original.currency}`,
    );
  }
  return null;
}
