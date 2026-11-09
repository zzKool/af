// Home — the year at a glance (F138, specs/dashboard US5, FR-006 – FR-008; the board *Pulse*, D77): the cash of
// every statement account in the base with its month and its twelve months, the currencies against the base and
// what the company holds in them, the next moves (the dashboard's items, ranked), the year's justified share, and —
// for the owner — the close of Work. Read only; every figure from its owner's read, derived on request.
import { Prisma } from "@/generated/prisma/client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import { addDays } from "@/kernel/clock/calendar";
import { tenantProfile } from "@/kernel/db/tenant";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { CURRENCIES } from "@/kernel/nav/constants";
import * as banking from "@/modules/banking";
import * as rates from "@/modules/rates";
import { workData } from "./close";
import { dashboardOverview } from "./overview";
import type { CashSummary, CurrencyTicker, HomeData } from "./types";
import { yearWeeks } from "./year-weeks";

/** The currencies' window on the home (the board: *90 days*). */
export const TICKER_DAYS = 90;

const D = (v: string) => new Prisma.Decimal(v);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

/** The last day of each of the twelve months before `today`'s, oldest first, then today. */
export function cashDays(today: string): string[] {
  const thisMonth = today.slice(0, 7);
  const out: string[] = [];
  for (let i = 12; i >= 1; i -= 1) out.push(banking.lastDayOf(banking.addMonths(thisMonth, -i)));
  out.push(today);
  return out;
}

/**
 * FR-006: the cash in the base. `history` holds each statement account's balance on each of `days` (the last is
 * today); `rateOf(day, currency)` the rate to the base on that day (1 for the base itself), null when there is
 * none — such an account is left out of that day's total, and today's leaves `incomplete`. Pure.
 */
export function cashSummary(
  base: string,
  days: readonly string[],
  history: readonly { label: string; currency: string; balances: readonly (string | null)[] }[],
  rateOf: (day: string, currency: string) => string | null,
): CashSummary {
  const last = days.length - 1;
  const inBase = (balance: string | null, day: string, currency: string) => {
    if (balance === null) return null;
    const r = currency === base ? "1" : rateOf(day, currency);
    return r === null ? null : D(balance).mul(D(r));
  };
  const totalOn = (i: number) => {
    let sum = new Prisma.Decimal(0);
    let any = false;
    for (const a of history) {
      const v = inBase(a.balances[i] ?? null, days[i] as string, a.currency);
      if (v) {
        sum = sum.add(v);
        any = true;
      }
    }
    return any ? sum : null;
  };
  const series = days.map((day, i) => {
    const t = totalOn(i);
    return { day, total: t ? money(t) : null };
  });
  const today = totalOn(last) ?? new Prisma.Decimal(0);
  const before = last > 0 ? totalOn(last - 1) : null;
  const accounts = history.map((a) => {
    const balance = a.balances[last] ?? null;
    const v = inBase(balance, days[last] as string, a.currency);
    return {
      label: a.label,
      currency: a.currency,
      balance,
      inBase: v ? money(v) : null,
      // a share and a percent are not money: whole numbers for the display
      share: v && today.gt(0) ? Number(v.div(today).mul(100).toFixed(0)) : 0,
    };
  });
  const foreign = new Map<string, Prisma.Decimal>();
  for (const a of accounts) {
    if (a.currency === base || a.inBase === null) continue;
    foreign.set(a.currency, (foreign.get(a.currency) ?? new Prisma.Decimal(0)).add(D(a.inBase)));
  }
  const exposure = [...foreign.entries()]
    .map(([currency, v]) => ({ currency, v: v.abs().div(100) }))
    .sort((a, b) => b.v.comparedTo(a.v))
    .map(({ currency, v }) => ({ currency, onePercent: money(v) }));
  return {
    base,
    total: money(today),
    monthDelta: before ? money(today.sub(before)) : null,
    series,
    accounts,
    exposure,
    incomplete: accounts.some((a) => a.balance !== null && a.inBase === null),
  };
}

/** FR-007: a currency's ticker from its series against the base (oldest first). Pure. */
export function ticker(series: rates.CurrencySeries): CurrencyTicker {
  const points = series.points.map((p) => p.rate);
  const first = points[0];
  const now = points.at(-1) ?? null;
  const change =
    first && now && points.length > 1
      ? Number(D(now).sub(D(first)).div(D(first)).mul(100).toFixed(1))
      : null;
  return { currency: series.currency, now, change, points };
}

export async function homeData(
  tx: TransactionClient,
  caller: CallerIdentity,
  today: string,
  since: Date | null,
): Promise<HomeData> {
  const overview = await dashboardOverview(tx, caller, today, since);
  const base = (await tenantProfile(tx, caller.tenantId))?.currency ?? CURRENCIES[0];

  // the cash: each statement account at the end of the last twelve months and today, through the day's rate
  const days = cashDays(today);
  const history = await banking.balanceHistory(tx, days);
  const rateMap = new Map<string, string | null>();
  for (const day of days)
    for (const currency of new Set(history.map((a) => a.currency))) {
      if (currency === base) continue;
      const r = await rates.rateToBase(tx, day, currency, base);
      rateMap.set(`${day}|${currency}`, r ? r.rate.toFixed(6) : null);
    }
  const cash = cashSummary(base, days, history, (day, c) => rateMap.get(`${day}|${c}`) ?? null);

  const window = await rates.rateHistory(tx, addDays(today, -TICKER_DAYS), today);
  const currencies = rates.crossSeries(window, base, CURRENCIES).map(ticker);

  const months = await banking.bankMonths(tx, { today });
  const year = today.slice(0, 4);
  const inYear = months.months.filter((m) => m.month.startsWith(year));
  const counts = {
    year,
    justified: inYear.reduce((s, m) => s + m.justified, 0),
    toJustify: inYear.reduce((s, m) => s + m.toJustify, 0),
  };

  const work = can(caller, "create", "bank_transaction")
    ? await workData(tx, caller, today, null, overview)
    : null;

  const statement = months.accounts.filter((a) => banking.STATEMENT_ROLES.includes(a.role));
  const weeks = yearWeeks(statement, months.days, today);

  return { overview, cash, currencies, year: counts, work, weeks };
}
