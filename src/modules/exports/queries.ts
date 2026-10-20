// Read API of the exports module: the Swiss VAT return of a quarter from the modules' read models (invoices under
// the stored period, the stored input VAT of supplier invoices and expenses under the CH registration), the
// periods, the declarations. Non-CHF amounts are converted at the ECB rate of the document's date (D23 names the
// FTA monthly rate; the ECB daily rate is what the app has — the conversion is a warning on the return).
import { Prisma } from "@/generated/prisma/browser";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import * as expenses from "@/modules/expenses";
import * as invoices from "@/modules/invoices";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { getDeclaration, listDeclarations } from "./declarations";
import { computeSwissVatReturn, periodOfDate, quarterBounds, quartersBetween } from "./swiss-vat";
import type { InputVatSourceRow, ReturnInvoice, SwissVatReturn } from "./types";

export { getDeclaration, listDeclarations };

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type ChRegistration = { id: string; vatNumber: string };

/** The CH registrations of the tenant — the return is per registration (usually one). */
export async function chRegistrations(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<ChRegistration[]> {
  const regs = await settings.getVatRegistrations(tx, caller);
  return (regs.data ?? [])
    .filter((r) => r.country === "CH")
    .map((r) => ({ id: r.id, vatNumber: r.vatNumber }));
}

/** Every quarter from the first declaration period any invoice carries to the current one, newest first. */
export async function swissVatPeriods(tx: TransactionClient, today: string): Promise<string[]> {
  const stored = await invoices.declarationPeriods(tx);
  const current = periodOfDate(today);
  const chPeriods = stored.filter((p) => p.startsWith("CH "));
  const first = chPeriods.at(-1);
  const all = quartersBetween(first && first < current ? first : current, current);
  // a stored period later than today's (a correction into the future) still shows
  for (const p of chPeriods) if (!all.includes(p)) all.unshift(p);
  return all;
}

type Converted = { amount: Dec; conversion: { rate: string; source: string } | null };

async function toChf(
  tx: TransactionClient,
  amount: string,
  currency: string,
  date: string,
): Promise<Converted | null> {
  if (currency === "CHF") return { amount: new D(amount), conversion: null };
  const r = await rates.rateToBase(tx, date, currency, "CHF");
  if (!r) return null;
  return {
    amount: new D(amount).mul(r.rate).toDecimalPlaces(2, D.ROUND_HALF_UP),
    conversion: { rate: r.rate.toFixed(6), source: r.source },
  };
}

/** The return of a quarter: the lines, the drill-down, the warnings, the declaration record. */
export async function swissVatReturn(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: { registrationId: string; period: string; today: string },
): Promise<ServiceResult<SwissVatReturn>> {
  const regs = await chRegistrations(tx, caller);
  const reg = regs.find((r) => r.id === input.registrationId);
  if (!reg) {
    return {
      error: { code: "NOT_FOUND", message: "CH VAT registration not found", retryable: false },
    };
  }
  const { from, to } = quarterBounds(input.period);
  const [docs, declaration, supplierRows, expenseRows] = await Promise.all([
    invoices.invoicesForDeclaration(tx, input.period),
    getDeclaration(tx, reg.id, input.period),
    supplierInvoices.inputVatSources(tx, { registrationId: reg.id, from, to }),
    expenses.inputVatSources(tx, { registrationId: reg.id, from, to }),
  ]);

  const returnInvoices: ReturnInvoice[] = [];
  const unconvertible: string[] = [];
  for (const inv of docs) {
    // only the documents issued under THIS registration count (another CH registration would be its own return)
    if (inv.vatRegistrationId && inv.vatRegistrationId !== reg.id) continue;
    const net = await toChf(tx, inv.netAmount, inv.currency, inv.issueDate);
    if (!net) {
      unconvertible.push(inv.number ?? inv.id);
      continue;
    }
    const factor = inv.currency === "CHF" ? new D(1) : net.amount.div(inv.netAmount || "1");
    const lines = inv.lines.map((l) => ({
      net: new D(l.netAmount).mul(factor).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
      rate: l.vatRate,
      vat: new D(l.vatAmount).mul(factor).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
    }));
    const country = inv.printedParties?.partner.address?.country ?? null;
    returnInvoices.push({
      id: inv.id,
      number: inv.number ?? inv.id,
      type: inv.type === "credit_note" ? "credit_note" : "invoice",
      issueDate: inv.issueDate,
      client: inv.partnerName,
      clientCountry: country,
      swissClient: invoices.isSwissCountry(country),
      currency: inv.currency,
      net: net.amount.toFixed(2),
      vat: lines.reduce((s, l) => s.plus(l.vat), new D(0)).toFixed(2),
      lines,
      conversion: net.conversion,
    });
  }

  const inputSources: InputVatSourceRow[] = [];
  for (const s of supplierRows) {
    const vat = await toChf(tx, s.vatAmount, s.currency, s.invoiceDate);
    if (!vat) {
      unconvertible.push(s.key);
      continue;
    }
    inputSources.push({
      kind: "supplier_invoice",
      id: s.id,
      key: s.key,
      label: `${s.partnerName} ${s.invoiceNumber}`,
      date: s.invoiceDate,
      currency: s.currency,
      net: s.amountNet,
      vat: vat.amount.toFixed(2),
      conversion: vat.conversion,
    });
  }
  for (const e of expenseRows) {
    const vat = await toChf(tx, e.vatAmount, e.currency, e.date);
    if (!vat) {
      unconvertible.push(e.key);
      continue;
    }
    inputSources.push({
      kind: "expense",
      id: e.id,
      key: e.key,
      label: e.description,
      date: e.date,
      currency: e.currency,
      net: new D(e.amount).minus(e.vatAmount).toFixed(2),
      vat: vat.amount.toFixed(2),
      conversion: vat.conversion,
    });
  }

  const computed = computeSwissVatReturn({
    period: input.period,
    invoices: returnInvoices,
    inputSources,
    manual: declaration?.manual ?? {},
    today: input.today,
  });
  const warnings = [...computed.warnings];
  for (const key of unconvertible) {
    warnings.push({
      type: "converted",
      message: `${key}: no ECB rate to convert to CHF — left out`,
      invoice: key,
      currency: "?",
      rate: "",
    });
  }
  return {
    data: {
      registrationId: reg.id,
      vatNumber: reg.vatNumber,
      period: input.period,
      from,
      to,
      // once declared, the snapshot is what the return says; the live figures are for comparison on the page
      lines: declaration?.snapshot ?? computed.lines,
      invoices: returnInvoices,
      inputSources,
      warnings,
      declaration,
    },
  };
}

/** "Declared on …" for an invoice's period — derived (D-e): the period has a declaration with `declaredAt`. */
export async function declaredOn(
  tx: TransactionClient,
  period: string | null,
): Promise<{ declaredAt: string; paidAt: string | null } | null> {
  if (!period) return null;
  const row = await tx.swissVatDeclaration.findFirst({
    where: { period, declaredAt: { not: null } },
    orderBy: { declaredAt: "desc" },
  });
  if (!row?.declaredAt) return null;
  return {
    declaredAt: row.declaredAt.toISOString().slice(0, 10),
    paidAt: row.paidAt ? row.paidAt.toISOString().slice(0, 10) : null,
  };
}

/** The `vat_payment` expenses — the picker of "paid with". */
export async function vatPaymentOptions(
  tx: TransactionClient,
): Promise<
  { id: string; key: string; label: string; date: string; amount: string; currency: string }[]
> {
  const list = await expenses.listExpenses(tx, {
    page: 1,
    pageSize: 200,
    sort: [{ col: "date", dir: "desc" }],
    filters: { kind: { kind: "in", values: ["vat_payment"] } },
  });
  return list.rows.map((e) => ({
    id: e.id,
    key: e.key,
    label: e.description,
    date: e.date,
    amount: e.amount,
    currency: e.currency,
  }));
}
