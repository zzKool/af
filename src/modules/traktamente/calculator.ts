// The per-diem calculator (specs/traktamente/spec.md US1, US2; D29) — pure, no I/O, property-tested.
//   countDays: Skatteverket's half-day rule per calendar day in the tenant zone — departure at or after 12:00 is a
//              half day, return at or before 19:00 is a half day, every day between is full; a same-day trip is
//              nothing (no overnight stay). Calendar arithmetic on dates, never milliseconds (DST-safe).
//   computePerDiem: each day × its own year's normalbelopp (half day 50 %), minus the meals paid separately
//              (abroad 15 / 35 / 35 % of the full day amount; Sweden the year's fixed krona amounts, triples at
//              the "all three" figure), plus the night amount for nights without paid lodging, × long-stay factor.
import { Prisma } from "@/generated/prisma/browser";
import { addDays } from "@/kernel/clock/calendar";
import type { DayCount, DayKind, PerDiemResult, PerDiemWarning, RateRow, TripDay } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** One tenant, one zone (later a tenant setting). */
export const TENANT_ZONE = "Europe/Stockholm";
export const HALF_DAY_FACTOR = "0.5";
export const DEPARTURE_HALF_FROM_MINUTES = 12 * 60;
export const RETURN_HALF_UNTIL_MINUTES = 19 * 60;
export const ABROAD_MEAL_SHARE = { breakfast: "0.15", lunch: "0.35", dinner: "0.35" } as const;
export const LONG_STAY_FACTORS = { fromThreeMonths: "0.7", fromTwoYears: "0.5" } as const;
export const NO_OVERNIGHT = "no overnight stay";

export type LocalDateTime = { date: string; minutes: number };

const LOCAL_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * The local date and clock time of an instant in `zone`. A string without an offset (`2026-03-10T08:00`) is
 * already local and is taken as is; a Date or an offset string is converted.
 */
export function toLocal(value: Date | string, zone: string = TENANT_ZONE): LocalDateTime {
  if (typeof value === "string") {
    const m = LOCAL_ISO.exec(value);
    if (m) return { date: m[1], minutes: Number(m[2]) * 60 + Number(m[3]) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error("timestamps required (minute precision)");
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`Not a timestamp: "${String(value)}"`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const LOCAL_WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** A local time in the tenant zone → the instant (Stockholm offset of that date). */
export function toInstant(value: string, zone: string = TENANT_ZONE): Date {
  if (!LOCAL_WALL.test(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error(`Not a timestamp: "${value}"`);
    return d;
  }
  // find the offset of the zone at that wall time: format a guess, compare, adjust once (DST-safe)
  const guess = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
  const offset = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return (asUtc - d.getTime()) / 60_000;
  };
  const first = new Date(guess.getTime() - offset(guess) * 60_000);
  return new Date(guess.getTime() - offset(first) * 60_000);
}

/**
 * The instants a rate year covers: from 1 January 00:00 to the next 1 January 00:00, Stockholm time — a trip
 * is counted in Stockholm (`countDays`), so is the year its rate belongs to (audit 28: UTC bounds let a return
 * at 00:30 on 1 January miss the new year, and a departure at 00:30 on 1 January count in the old one).
 */
export function rateYearBounds(year: number, zone: string = TENANT_ZONE): { from: Date; to: Date } {
  return {
    from: toInstant(`${year}-01-01T00:00`, zone),
    to: toInstant(`${year + 1}-01-01T00:00`, zone),
  };
}

export function countDays(
  departure: Date | string,
  returned: Date | string,
  zone: string = TENANT_ZONE,
): DayCount {
  const dep = toLocal(departure, zone);
  const ret = toLocal(returned, zone);
  if (ret.date < dep.date || (ret.date === dep.date && ret.minutes <= dep.minutes)) {
    throw new Error("The return must be after the departure");
  }
  if (dep.date === ret.date) {
    return { fullDays: 0, halfDays: 0, nights: 0, days: 0, perDay: [], reason: NO_OVERNIGHT };
  }
  const perDay: DayCount["perDay"] = [];
  for (let date = dep.date; date <= ret.date; date = addDays(date, 1)) {
    let kind: DayKind = "full";
    if (date === dep.date && dep.minutes >= DEPARTURE_HALF_FROM_MINUTES) kind = "half";
    if (date === ret.date && ret.minutes <= RETURN_HALF_UNTIL_MINUTES) kind = "half";
    perDay.push({ date, kind, year: Number(date.slice(0, 4)) });
  }
  const fullDays = perDay.filter((d) => d.kind === "full").length;
  const halfDays = perDay.length - fullDays;
  return {
    fullDays,
    halfDays,
    nights: perDay.length - 1,
    days: fullDays + halfDays / 2,
    perDay,
    reason: null,
  };
}

export type PerDiemTrip = {
  departureAt: Date | string;
  returnAt: Date | string;
  countryCode: string;
  breakfasts: number;
  lunches: number;
  dinners: number;
  nightsWithoutPaidLodging: number;
  longStayFactor?: string | null;
};

export class PerDiemError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "PerDiemError";
  }
}

const money = (d: Dec): string => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);

function mealDeduction(
  trip: PerDiemTrip,
  rate: RateRow,
  dayAmount: Dec,
): { deduction: Dec; warnings: PerDiemWarning[] } {
  const warnings: PerDiemWarning[] = [];
  const b = new D(trip.breakfasts);
  const l = new D(trip.lunches);
  const d = new D(trip.dinners);
  if (rate.countryCode === "SE") {
    if (!rate.mealBreakfast || !rate.mealLunch || !rate.mealDinner || !rate.mealAll) {
      throw new PerDiemError(
        `The Swedish meal amounts of ${rate.year} are missing in the rate table`,
        { rule: "missing_meal_amounts", year: rate.year },
      );
    }
    const triples = D.min(b, l, d);
    const deduction = triples
      .mul(rate.mealAll)
      .plus(b.minus(triples).mul(rate.mealBreakfast))
      .plus(l.minus(triples).mul(rate.mealLunch))
      .plus(d.minus(triples).mul(rate.mealDinner));
    return { deduction, warnings };
  }
  const deduction = b
    .mul(ABROAD_MEAL_SHARE.breakfast)
    .plus(l.mul(ABROAD_MEAL_SHARE.lunch))
    .plus(d.mul(ABROAD_MEAL_SHARE.dinner))
    .mul(dayAmount);
  return { deduction, warnings };
}

/**
 * The per-diem of a trip. `rates` holds the country's rows by year; a missing year throws
 * `No travel allowance rate for CH in 2026`.
 */
export function computePerDiem(
  trip: PerDiemTrip,
  rates: ReadonlyMap<number, RateRow>,
  options: { zone?: string; now?: Date } = {},
): PerDiemResult {
  const count = countDays(trip.departureAt, trip.returnAt, options.zone ?? TENANT_ZONE);
  const factor = trip.longStayFactor ? new D(trip.longStayFactor) : new D(1);
  if (factor.lte(0) || factor.gt(1))
    throw new PerDiemError("The long-stay factor is between 0 and 1", { rule: "long_stay" });
  for (const [what, n] of [
    ["breakfasts", trip.breakfasts],
    ["lunches", trip.lunches],
    ["dinners", trip.dinners],
    ["nightsWithoutPaidLodging", trip.nightsWithoutPaidLodging],
  ] as const) {
    if (!Number.isInteger(n) || n < 0)
      throw new PerDiemError(`${what} must be a whole number ≥ 0`, {
        rule: "not_a_count",
        field: what,
      });
  }
  const computedAt = (options.now ?? new Date()).toISOString();
  const empty: PerDiemResult = {
    ...count,
    countryCode: trip.countryCode,
    rateYears: [],
    mealRateYear: Number(toLocal(trip.departureAt, options.zone).date.slice(0, 4)),
    perDay: [],
    dayTotal: "0.00",
    meals: {
      breakfasts: trip.breakfasts,
      lunches: trip.lunches,
      dinners: trip.dinners,
      deduction: "0.00",
    },
    nightAllowance: { nights: trip.nightsWithoutPaidLodging, nightAmount: "0.00", total: "0.00" },
    longStayFactor: trip.longStayFactor ?? null,
    total: "0.00",
    warnings: [],
    computedAt,
  };
  if (count.reason) return empty;

  const calendarDays = count.perDay.length;
  for (const [what, meal, n] of [
    ["Breakfasts", "breakfasts", trip.breakfasts],
    ["Lunches", "lunches", trip.lunches],
    ["Dinners", "dinners", trip.dinners],
  ] as const) {
    if (n > calendarDays) {
      throw new PerDiemError(`${what} (${n}) exceed the ${calendarDays} days of the trip`, {
        rule: "too_many_meals",
        meal,
        count: n,
        days: calendarDays,
      });
    }
  }
  if (trip.nightsWithoutPaidLodging > count.nights) {
    throw new PerDiemError(
      `Nights without paid lodging (${trip.nightsWithoutPaidLodging}) exceed the ${count.nights} nights of the trip`,
      { rule: "too_many_nights", count: trip.nightsWithoutPaidLodging, nights: count.nights },
    );
  }
  const years = [...new Set(count.perDay.map((d) => d.year))].sort();
  for (const y of years) {
    if (!rates.get(y)) {
      throw new PerDiemError(`No travel allowance rate for ${trip.countryCode} in ${y}`, {
        rule: "missing_rate",
        countryCode: trip.countryCode,
        year: y,
      });
    }
  }
  const warnings: PerDiemWarning[] = [];
  if (years.length > 1) {
    const list = years.join(", ");
    warnings.push({
      type: "two_rate_years",
      message: `trip spans two rate years (${list})`,
      years: list,
    });
  }

  const perDay: TripDay[] = count.perDay.map((d) => {
    const rate = rates.get(d.year) as RateRow;
    const amount = new D(rate.dayAmount).mul(d.kind === "half" ? HALF_DAY_FACTOR : 1).mul(factor);
    return { ...d, amount: money(amount) };
  });
  const dayTotal = perDay.reduce<Dec>((acc, d) => acc.plus(d.amount), new D(0));

  const mealRateYear = empty.mealRateYear;
  const mealRate = rates.get(mealRateYear) as RateRow;
  const meals = mealDeduction(trip, mealRate, new D(mealRate.dayAmount).mul(factor));
  warnings.push(...meals.warnings);
  const nightAmount = mealRate.nightAmount
    ? new D(mealRate.nightAmount)
    : new D(mealRate.dayAmount).mul(HALF_DAY_FACTOR);
  const nightTotal = nightAmount.mul(trip.nightsWithoutPaidLodging);

  let total = dayTotal.minus(meals.deduction).plus(nightTotal);
  if (total.lt(0)) {
    warnings.push({
      type: "meals_exceed_days",
      message: "the meal deduction exceeds the day amounts — nothing is tax-free",
    });
    total = new D(0);
  }
  return {
    ...empty,
    rateYears: years,
    perDay,
    dayTotal: money(dayTotal),
    meals: { ...empty.meals, deduction: money(meals.deduction) },
    nightAllowance: {
      nights: trip.nightsWithoutPaidLodging,
      nightAmount: money(nightAmount),
      total: money(nightTotal),
    },
    total: money(total),
    warnings,
  };
}

/** `Traktamente CH 19.5 days` — the per-diem expense's description. */
export function perDiemDescription(result: PerDiemResult): string {
  return `Traktamente ${result.countryCode} ${result.days} day${result.days === 1 ? "" : "s"}`;
}

/** The breakdown as the expense's note (and the statement's detail). */
export function perDiemNote(result: PerDiemResult): string {
  const lines = [
    `${result.fullDays} full day(s) + ${result.halfDays} half day(s) = ${result.days} days, ${result.nights} night(s)`,
    `Day amounts (${result.rateYears.join(", ")}): ${result.dayTotal} SEK`,
  ];
  const m = result.meals;
  if (m.breakfasts || m.lunches || m.dinners) {
    lines.push(
      `Meals paid separately: ${m.breakfasts} breakfast(s), ${m.lunches} lunch(es), ${m.dinners} dinner(s) = -${m.deduction} SEK`,
    );
  }
  if (result.nightAllowance.nights > 0) {
    lines.push(
      `Nights without paid lodging: ${result.nightAllowance.nights} × ${result.nightAllowance.nightAmount} = ${result.nightAllowance.total} SEK`,
    );
  }
  if (result.longStayFactor) lines.push(`Long stay factor ${result.longStayFactor}`);
  lines.push(`Total ${result.total} SEK`);
  for (const w of result.warnings) lines.push(`Note: ${w.message}`);
  return lines.join("\n");
}
