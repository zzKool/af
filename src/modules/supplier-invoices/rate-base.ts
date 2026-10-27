// The SEK base: written once from the invoice date's rate (ECB, or a typed manual rate); an open invoice's edit
// asks again only when the currency, or the date of an ECB rate, changed (audit 5, D37).
import { Prisma } from "@/generated/prisma/browser";
import type { SupplierInvoice } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import * as rates from "@/modules/rates";
import { iso } from "./dto";
import { invalid, violation } from "./errors";
import type { SupplierInvoiceRateSource } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

// --- the SEK base ---

type Base = {
  amountBase: Dec;
  rate: Dec;
  rateSource: SupplierInvoiceRateSource;
  rateDate: string | null;
};

export function baseAmount(amount: Dec | string, rate: Dec | string): Dec {
  return new D(amount).mul(new D(rate)).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export async function baseFor(
  tx: TransactionClient,
  date: string,
  amount: Dec,
  currency: string,
  typedRate: string | undefined,
): Promise<ServiceResult<Base>> {
  if (typedRate !== undefined) {
    if (currency === BASE_CURRENCY && !new D(typedRate).eq(1)) {
      return { error: invalid(`The rate of a ${BASE_CURRENCY} amount is 1`) };
    }
    const rate = new D(typedRate);
    return {
      data: {
        amountBase: baseAmount(amount, rate),
        rate,
        rateSource: currency === BASE_CURRENCY ? "same_currency" : "manual",
        rateDate: null,
      },
    };
  }
  const r = await rates.rateToBase(tx, date, currency, BASE_CURRENCY);
  if (!r) {
    return {
      error: violation(`No exchange rate for ${date} — run the ECB sync`, { date, currency }),
    };
  }
  return {
    data: {
      amountBase: baseAmount(amount, r.rate),
      rate: r.rate,
      rateSource: r.source,
      rateDate: r.source === "same_currency" ? null : r.rateDate,
    },
  };
}

/**
 * The base of an edited open invoice (audit 5, D37): a typed rate is manual; another currency, or another date on a
 * rate that came from the ECB, asks the ECB again; otherwise the stored rate stays — a manual rate is never replaced
 * by an edit that did not touch it — and only the base follows a new total.
 */
export async function rebase(
  tx: TransactionClient,
  row: Pick<SupplierInvoice, "invoiceDate" | "currency" | "rate" | "rateSource" | "rateDate">,
  next: { invoiceDate: string; total: string; currency: string; typedRate: string | undefined },
): Promise<ServiceResult<Base>> {
  const currencyChanged = next.currency !== row.currency;
  const dateChanged = next.invoiceDate !== iso(row.invoiceDate);
  const ecbRate = row.rateSource !== "manual" && row.rateSource !== "same_currency";
  if (next.typedRate !== undefined || currencyChanged || (dateChanged && ecbRate)) {
    return baseFor(tx, next.invoiceDate, new D(next.total), next.currency, next.typedRate);
  }
  return {
    data: {
      amountBase: baseAmount(next.total, row.rate),
      rate: row.rate,
      // never `bank` on an entity (F114, CHECK)
      rateSource: row.rateSource as SupplierInvoiceRateSource,
      rateDate: iso(row.rateDate),
    },
  };
}
