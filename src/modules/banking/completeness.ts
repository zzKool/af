// Completeness by balance (F115, audit B4): the bank's running balance is the proof that no row is missing. Nordea
// gives the end-of-day balance on the last row of each day; for two balanced days d₁ < d₂ the chain
//   balance(d₁) + Σ amount(rows with d₁ < date ≤ d₂) = balance(d₂)
// holds exactly when every row between them is here — inside one export and between two. A day without a balance
// is summed into the next balanced day. Pure; the read is `accountCompleteness` in queries.ts, the import reports
// the gaps it finds, the Months grid says *complete to <date>* — never *proven* on half a month.
import { Prisma } from "@/generated/prisma/browser";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type BalanceRow = {
  /** ISO day */
  bookingDate: string;
  amount: string | Dec;
  /** the running balance after the row, when the bank gave one */
  balance: string | Dec | null;
  /** the row's position in its file — Nordea lists newest first, so the day's end-of-day balance sits on the lowest */
  rowIndex: number;
};

/** The chain broke between two balanced days: rows are missing (or doubled) in between — most often between two exports. */
export type BalanceGap = {
  /** the last balanced day that still agreed */
  from: string;
  /** the balanced day whose balance did not follow */
  to: string;
  /** `from`'s balance + Σ amounts up to and including `to` */
  expected: string;
  /** what the bank says at `to` */
  actual: string;
  /** `actual − expected`: what the missing rows add up to */
  difference: string;
};

export type Completeness = {
  /** the first balanced day — nothing before it is proven (a row of that day could be missing too) */
  completeFrom: string | null;
  /** the last balanced day the chain reaches without a gap — every row after `completeFrom` up to here is present */
  completeTo: string | null;
  gaps: BalanceGap[];
  /** how many days carried a balance */
  balancedDays: number;
};

type Day = { date: string; sum: Dec; balances: { balance: Dec; rowIndex: number }[] };

/** The chain over an account's rows (any order). */
export function balanceChain(rows: readonly BalanceRow[]): Completeness {
  const days = new Map<string, Day>();
  for (const r of rows) {
    const d = days.get(r.bookingDate) ?? { date: r.bookingDate, sum: new D(0), balances: [] };
    d.sum = d.sum.plus(r.amount);
    if (r.balance !== null) d.balances.push({ balance: new D(r.balance), rowIndex: r.rowIndex });
    days.set(r.bookingDate, d);
  }
  const ordered = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));

  const gaps: BalanceGap[] = [];
  let completeFrom: string | null = null;
  let completeTo: string | null = null;
  let running: Dec | null = null;
  let pending = new D(0); // Σ amounts since the last balanced day, that day excluded
  let lastBalanced: string | null = null;
  let balancedDays = 0;
  for (const day of ordered) {
    pending = pending.plus(day.sum);
    if (day.balances.length === 0) continue;
    balancedDays += 1;
    const expected = running === null ? null : running.plus(pending);
    const actual = endOfDay(day.balances, expected);
    if (expected !== null && lastBalanced !== null && !actual.eq(expected)) {
      gaps.push({
        from: lastBalanced,
        to: day.date,
        expected: expected.toFixed(2),
        actual: actual.toFixed(2),
        difference: actual.minus(expected).toFixed(2),
      });
    } else if (gaps.length === 0) {
      completeTo = day.date;
    }
    if (completeFrom === null) completeFrom = day.date;
    running = actual;
    pending = new D(0);
    lastBalanced = day.date;
  }
  return { completeFrom, completeTo, gaps, balancedDays };
}

/**
 * The day's end-of-day balance: the one that agrees with the chain when several rows of the day carry one
 * (an older export with a balance on every row), else the lowest row in the file (Nordea lists newest first).
 */
function endOfDay(
  balances: readonly { balance: Dec; rowIndex: number }[],
  expected: Dec | null,
): Dec {
  if (expected !== null) {
    const agreeing = balances.find((b) => b.balance.eq(expected));
    if (agreeing) return agreeing.balance;
  }
  return [...balances].sort((a, b) => a.rowIndex - b.rowIndex)[0]?.balance ?? new D(0);
}

/**
 * Whether the chain proves a whole month: a balanced day before the month and the chain reaching its last day —
 * the month still running, a month the first export starts in, and a month after a gap are never complete.
 */
export function monthComplete(c: Completeness, month: string): boolean {
  if (!c.completeFrom || !c.completeTo) return false;
  return c.completeFrom < `${month}-01` && c.completeTo >= lastDayOf(month);
}

/** `2026-02` → `2026-02-28` (ISO; a leap year's February gets its 29th). */
export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}
