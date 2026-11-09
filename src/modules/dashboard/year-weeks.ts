// The year, week by week (F158, the Pulse board's year strip) — pure. Fifty-two weeks back from today's week
// (Monday to Sunday): on top the money in and out of the statement accounts in the base; under it one square per
// account per week — done (every row justified) · open (rows to justify, the month's close still running) · late
// (rows to justify in a month before last month: its close is past) · none (no row). Built from the bank's day
// cells the home already reads (`bankMonths`); nothing stored.
import { Prisma } from "@/generated/prisma/client";
import { addDays } from "@/kernel/clock/calendar";

export const YEAR_WEEKS = 52;

export type WeekCellState = "done" | "open" | "late" | "none";

export type YearWeek = {
  /** Monday, yyyy-mm-dd */
  from: string;
  /** Sunday */
  to: string;
  /** ISO week number */
  number: number;
  inBase: string;
  outBase: string;
  rows: number;
  toJustify: number;
  /** per account, in `accounts`' order */
  cells: WeekCellState[];
};

export type YearWeeks = {
  accounts: { id: string; label: string; currency: string }[];
  weeks: YearWeek[];
};

/** The Monday of `day`'s week. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(day, -back);
}

/** ISO 8601 week number of a Monday: the week's Thursday decides — its day of the year, by sevens. */
export function isoWeek(monday: string): number {
  const thursday = new Date(`${addDays(monday, 3)}T00:00:00Z`);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
}

/** The first month whose rows still open count as *late*: everything before last month. */
const lateBefore = (today: string): string => {
  const [y, m] = today.slice(0, 7).split("-").map(Number) as [number, number];
  const n = y * 12 + (m - 1) - 1;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
};

export function yearWeeks(
  accounts: readonly { id: string; label: string; currency: string }[],
  days: readonly {
    date: string;
    bankAccountId: string;
    rows: number;
    toJustify: number;
    inBase: string;
    outBase: string;
  }[],
  today: string,
): YearWeeks {
  const last = mondayOf(today);
  const first = addDays(last, -7 * (YEAR_WEEKS - 1));
  const late = lateBefore(today);
  const index = new Map<string, number>();
  const weeks: YearWeek[] = [];
  for (let i = 0; i < YEAR_WEEKS; i += 1) {
    const from = addDays(first, 7 * i);
    index.set(from, i);
    weeks.push({
      from,
      to: addDays(from, 6),
      number: isoWeek(from),
      inBase: "0.00",
      outBase: "0.00",
      rows: 0,
      toJustify: 0,
      cells: accounts.map(() => "none"),
    });
  }
  const D = Prisma.Decimal;
  const ins = weeks.map(() => new D(0));
  const outs = weeks.map(() => new D(0));
  const col = new Map(accounts.map((a, i) => [a.id, i]));
  // per week × account: rows and the open ones, and whether an open one sits in a month already closed
  const tally = weeks.map(() => accounts.map(() => ({ rows: 0, open: 0, late: false })));
  for (const d of days) {
    const w = index.get(mondayOf(d.date));
    const a = col.get(d.bankAccountId);
    if (w === undefined || a === undefined) continue;
    ins[w] = (ins[w] as InstanceType<typeof D>).plus(d.inBase);
    outs[w] = (outs[w] as InstanceType<typeof D>).plus(d.outBase);
    const t = tally[w]?.[a];
    if (!t) continue;
    t.rows += d.rows;
    t.open += d.toJustify;
    if (d.toJustify > 0 && d.date.slice(0, 7) < late) t.late = true;
  }
  weeks.forEach((week, w) => {
    week.inBase = (ins[w] as InstanceType<typeof D>).toFixed(2);
    week.outBase = (outs[w] as InstanceType<typeof D>).toFixed(2);
    week.cells = (tally[w] ?? []).map((t) =>
      t.rows === 0 ? "none" : t.open === 0 ? "done" : t.late ? "late" : "open",
    );
    week.rows = (tally[w] ?? []).reduce((s, t) => s + t.rows, 0);
    week.toJustify = (tally[w] ?? []).reduce((s, t) => s + t.open, 0);
  });
  return { accounts: accounts.map(({ id, label, currency }) => ({ id, label, currency })), weeks };
}
