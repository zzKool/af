// The day the books reach (F189, the gap review of 2026-11-13). The home's year and Work's month are anchored on
// today — right for books kept up to date, hollow for books that stop earlier (a first quarter keyed in from the
// start of the activity: everything drawn is three years of nothing). One rule, pure: today, unless the newest
// bank row is older than last month — then the last day of that row's month, and the page says so.
import * as banking from "@/modules/banking";

export type BooksDay = {
  /** the day the year's views take as their today */
  day: string;
  /** true when the books stop before last month: `day` is the end of their last month, not today */
  behind: boolean;
};

export function booksDay(today: string, lastRowDay: string | null): BooksDay {
  if (!lastRowDay || lastRowDay >= today) return { day: today, behind: false };
  const lastMonth = banking.addMonths(today.slice(0, 7), -1);
  const rowMonth = lastRowDay.slice(0, 7);
  if (rowMonth >= lastMonth) return { day: today, behind: false };
  return { day: banking.lastDayOf(rowMonth), behind: true };
}

/** The newest day with a bank row, from the months read's day cells (`bankMonths().days`, sorted or not). */
export function lastRowDay(days: readonly { date: string; rows: number }[]): string | null {
  let last: string | null = null;
  for (const d of days) if (d.rows > 0 && (last === null || d.date > last)) last = d.date;
  return last;
}
