// The year, week by week (F158, the Pulse board's year strip) — pure. Fifty-two weeks back from today's week
// (Monday to Sunday): on top the money in and out of the statement accounts in the base; under it one square per
// account per week — done (every row justified) · open (rows to justify, the month's close still running) · late
// (rows to justify in a month before last month: its close is past) · none (no row). Built from the bank's day
// cells the home already reads (`bankMonths`); nothing stored.
// F171, the board's other rows: one square per week for the invoices issued, the expenses dated and the documents
// received that week, in the same families — each thing's state derived by its own module (`invoiceCell`,
// `expenseCell`, `documentCell` map it), the week the worst of its things: late › open › done › none.
import { Prisma } from "@/generated/prisma/browser";
import { addDays } from "@/kernel/clock/calendar";

export const YEAR_WEEKS = 52;

export type WeekCellState = "done" | "open" | "late" | "none";
export type BookCell = Exclude<WeekCellState, "none">;

/** The board's rows under the bank accounts, in its order. */
export const BOOK_LANES = ["invoices", "expenses", "documents"] as const;
export type BookLane = (typeof BOOK_LANES)[number];
/** One thing of the books on its day (yyyy-mm-dd), its state already in the strip's family. */
export type BookFact = { date: string; cell: BookCell };
export type BookFacts = Record<BookLane, readonly BookFact[]>;
/** A lane's week: its square, how many things, how many still open or late. */
export type BookWeek = { cell: WeekCellState; count: number; pending: number };

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
  /** F171: the invoices, expenses and documents of the week */
  books: Record<BookLane, BookWeek>;
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

/**
 * An invoice's square (F171): issued that week — paid or fully credited → done, overdue → late, still to be paid
 * (issued, sent, partly paid) → open. A draft, a quote and a credit note are not on the row (null).
 */
export function invoiceCell(r: { type: string; state: string }): BookCell | null {
  if (r.type !== "invoice") return null;
  switch (r.state) {
    case "paid":
    case "credited":
      return "done";
    case "overdue":
      return "late";
    case "issued":
    case "sent":
    case "partially_paid":
      return "open";
    default:
      return null;
  }
}

/**
 * An expense's square (F171): done once settled (paid / refunded) **and** justified — its receipt attached, the
 * receipt declared lost (`documentMissing`), or a per diem (computed, no receipt); otherwise open, late when its
 * date is in a month before last month (the month's close is past — the bank rows' rule).
 */
export function expenseCell(
  r: { date: string; status: string; kind: string; hasDocument: boolean; documentMissing: boolean },
  today: string,
): BookCell {
  const settled = r.status === "paid" || r.status === "refunded";
  const justified = r.hasDocument || r.documentMissing || r.kind === "per_diem";
  if (settled && justified) return "done";
  return r.date.slice(0, 7) < lateBefore(today) ? "late" : "open";
}

/**
 * A document's square (F171), on the day it was received: filed (it became something, or was reviewed) or
 * parked by the owner (archived) → done; still in the inbox (OCR pending or failed, ready to decide) → to review,
 * open — late when received in a month before last month. The app's own PDFs (generated) are not received: null.
 */
export function documentCell(state: string, day: string, today: string): BookCell | null {
  if (state === "generated") return null;
  if (state === "filed" || state === "archived") return "done";
  return day.slice(0, 7) < lateBefore(today) ? "late" : "open";
}

const RANK: Record<WeekCellState, number> = { none: 0, done: 1, open: 2, late: 3 };
const NO_BOOKS: BookFacts = { invoices: [], expenses: [], documents: [] };
const emptyBooks = (): Record<BookLane, BookWeek> => ({
  invoices: { cell: "none", count: 0, pending: 0 },
  expenses: { cell: "none", count: 0, pending: 0 },
  documents: { cell: "none", count: 0, pending: 0 },
});

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
  books: BookFacts = NO_BOOKS,
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
      books: emptyBooks(),
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
  for (const lane of BOOK_LANES)
    for (const f of books[lane]) {
      const w = index.get(mondayOf(f.date));
      const b = w === undefined ? undefined : weeks[w]?.books[lane];
      if (!b) continue;
      b.count += 1;
      if (f.cell !== "done") b.pending += 1;
      if (RANK[f.cell] > RANK[b.cell]) b.cell = f.cell;
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
