// Read API of the exports module: the Swiss VAT return of a quarter from the modules' read models (invoices under
// the stored period with their stored VAT per rate, the stored input VAT of supplier invoices and expenses under
// the CH registration), the periods, the declarations. Non-CHF amounts are converted at the ECB rate of the
// document's date (D23 names the FTA monthly rate; the ECB daily rate is what the app has — the conversion is a
// warning on the return).
import { Prisma } from "@/generated/prisma/browser";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import * as expenses from "@/modules/expenses";
import * as invoices from "@/modules/invoices";
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { getDeclaration, listDeclarations, withPaymentDate } from "./declaration-read";
import { periodOfDate } from "./period";
import { computeSwissVatReturn, quarterBounds, quartersBetween, rateKey } from "./swiss-vat";
import type { InputVatSourceRow, ReturnInvoice, ReturnRate, SwissVatReturn } from "./types";

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

const chf = (d: Dec): Dec => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

type Converted = { amount: Dec; conversion: { rate: string; source: string } | null };
type ChfRate = { rate: Dec; conversion: { rate: string; source: string } | null };

/** The rate that turns `currency` into CHF on `date` (1 for CHF), or null when the ECB has none. */
async function chfRate(
  tx: TransactionClient,
  currency: string,
  date: string,
): Promise<ChfRate | null> {
  if (currency === "CHF") return { rate: new D(1), conversion: null };
  const r = await rates.rateToBase(tx, date, currency, "CHF");
  if (!r) return null;
  return { rate: new D(r.rate), conversion: { rate: r.rate.toFixed(6), source: r.source } };
}

async function toChf(
  tx: TransactionClient,
  amount: string,
  currency: string,
  date: string,
): Promise<Converted | null> {
  const r = await chfRate(tx, currency, date);
  if (!r) return null;
  return { amount: chf(new D(amount).mul(r.rate)), conversion: r.conversion };
}

type DeclarationInvoice = Awaited<ReturnType<typeof invoices.invoicesForDeclaration>>[number];

/**
 * An invoice as the return counts it, from its STORED figures (lessons 1, 21): the taxed part is its `vatByRate`
 * (the header discount applied, VAT rounded per rate — what the printed invoice says), the 0 % part is the rest of
 * its net when it has 0 % lines. Each amount converted to CHF at the one rate of the issue date.
 */
export function returnInvoice(inv: DeclarationInvoice, rate: ChfRate): ReturnInvoice {
  const rates: ReturnRate[] = inv.vatByRate
    .filter((r) => !new D(r.rate).isZero())
    .map((r) => ({
      rate: rateKey(r.rate),
      base: chf(new D(r.base).mul(rate.rate)).toFixed(2),
      vat: chf(new D(r.vat).mul(rate.rate)).toFixed(2),
    }));
  const net = chf(new D(inv.netAmount).mul(rate.rate));
  const taxed = rates.reduce((s, r) => s.plus(r.base), new D(0));
  const hasZeroLines = inv.lines.some((l) => new D(l.vatRate).isZero());
  const zeroRated = hasZeroLines ? net.minus(taxed) : new D(0);
  const country = inv.printedParties?.partner.address?.country ?? null;
  return {
    id: inv.id,
    number: inv.number ?? inv.id,
    type: inv.type === "credit_note" ? "credit_note" : "invoice",
    issueDate: inv.issueDate,
    client: inv.partnerName,
    clientCountry: country,
    swissClient: invoices.isSwissCountry(country),
    currency: inv.currency,
    net: net.toFixed(2),
    vat: rates.reduce((s, r) => s.plus(r.vat), new D(0)).toFixed(2),
    rates,
    zeroRated: (zeroRated.isNegative() ? new D(0) : zeroRated).toFixed(2),
    conversion: rate.conversion,
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
    const rate = await chfRate(tx, inv.currency, inv.issueDate);
    if (!rate) {
      unconvertible.push(inv.number ?? inv.id);
      continue;
    }
    returnInvoices.push(returnInvoice(inv, rate));
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
  const frozen = declaration?.declaredAt ? declaration.snapshot : null;
  if (declaration?.declaredAt && !frozen) {
    warnings.push({
      type: "snapshot_unreadable",
      message: `${input.period} is declared but its stored figures do not read as a form — the live figures are shown`,
    });
  }
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
      // once declared, the snapshot (the server's own figures at declaring) is what the return says
      lines: frozen ?? computed.lines,
      invoices: returnInvoices,
      inputSources,
      warnings,
      declaration,
    },
  };
}

/**
 * "Declared on …" for an invoice's period — derived (D-e): the period has a declaration with `declaredAt`; paid on
 * as the declaration derives it. Pass the invoice's VAT registration so another CH registration's declaration of
 * the same quarter never counts (lesson 1); without it, any CH registration's (the usual single one).
 */
export async function declaredOn(
  tx: TransactionClient,
  period: string | null,
  vatRegistrationId?: string | null,
): Promise<{ declaredAt: string; paidAt: string | null } | null> {
  if (!period) return null;
  const row = await tx.swissVatDeclaration.findFirst({
    where: {
      period,
      declaredAt: { not: null },
      ...(vatRegistrationId ? { vatRegistrationId } : {}),
    },
    orderBy: { declaredAt: "desc" },
  });
  if (!row?.declaredAt) return null;
  const dto = await withPaymentDate(tx, row);
  return { declaredAt: dto.declaredAt as string, paidAt: dto.paidAt };
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
