// Periods — pure. A month `2026-06` or a year `2026` (D31); ISO bounds; the months of a year; labels.
import type { PackagePeriod } from "./types";

const MONTH = /^(\d{4})-(\d{2})$/;
const YEAR = /^\d{4}$/;

export function isPackagePeriod(value: string): boolean {
  if (YEAR.test(value)) return true;
  const m = MONTH.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/** The last day of a month, ISO. */
export function lastDayOf(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

export function parsePeriod(value: string): PackagePeriod {
  if (!isPackagePeriod(value)) throw new Error(`Not a package period: "${value}"`);
  if (YEAR.test(value)) {
    return { kind: "year", period: value, from: `${value}-01-01`, to: `${value}-12-31` };
  }
  const [year, month] = value.split("-").map(Number) as [number, number];
  return { kind: "month", period: value, from: `${value}-01`, to: lastDayOf(year, month) };
}

/** `2026-01` … `2026-12`. */
export function monthsOf(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** The month of an ISO date: `2026-06-12` → `2026-06`. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Every month from `first` to `last` inclusive, newest first. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = last.split("-").map(Number) as [number, number];
  const [fy, fm] = first.split("-").map(Number) as [number, number];
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** `2026-06` → "June 2026" (en) / "juin 2026" (fr); `2026` → "2026". */
export function periodLabel(period: string, locale = "en"): string {
  if (YEAR.test(period)) return period;
  const [y, m] = period.split("-").map(Number) as [number, number];
  const name = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${name} ${y}`;
}
