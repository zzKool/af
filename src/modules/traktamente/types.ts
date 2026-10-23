// DTOs of the traktamente module (specs/traktamente/spec.md). Decimals are strings.

export type NormalbeloppDto = {
  id: string;
  tenantId: string;
  year: number;
  countryCode: string;
  countryNameSv: string;
  countryNameEn: string | null;
  dayAmount: string;
  nightAmount: string | null;
  mealBreakfast: string | null;
  mealLunch: string | null;
  mealDinner: string | null;
  mealAll: string | null;
  rateSource: string;
  createdAt: Date;
  updatedAt: Date;
};

/** What the calculator needs of a rate row. */
export type RateRow = {
  year: number;
  countryCode: string;
  dayAmount: string;
  nightAmount: string | null;
  mealBreakfast: string | null;
  mealLunch: string | null;
  mealDinner: string | null;
  mealAll: string | null;
};

export type TripDto = {
  id: string;
  tenantId: string;
  groupId: string;
  departureAt: Date;
  returnAt: Date;
  countryCode: string;
  agency: string | null;
  breakfasts: number;
  lunches: number;
  dinners: number;
  nightsWithoutPaidLodging: number;
  longStayFactor: string | null;
  computed: PerDiemResult | null;
  perDiemExpenseId: string | null;
  perDiemDocumentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DayKind = "full" | "half";

export type TripDay = { date: string; kind: DayKind; year: number; amount: string };

export type DayCount = {
  fullDays: number;
  halfDays: number;
  nights: number;
  /** full + 0.5 × half */
  days: number;
  perDay: { date: string; kind: DayKind; year: number }[];
  /** set when nothing is tax-free (a same-day trip) */
  reason: string | null;
};

export type PerDiemResult = Omit<DayCount, "perDay"> & {
  countryCode: string;
  rateYears: number[];
  /** the year whose row prices the meals and the nights (the departure year) */
  mealRateYear: number;
  perDay: TripDay[];
  dayTotal: string;
  meals: { breakfasts: number; lunches: number; dinners: number; deduction: string };
  nightAllowance: { nights: number; nightAmount: string; total: string };
  longStayFactor: string | null;
  total: string;
  warnings: PerDiemWarning[];
  computedAt: string;
};

/**
 * A warning on the breakdown: the English `message` (the expense's note, logs) and the facts a screen renders
 * in its own language (T003). `other` is a line of an older snapshot that no longer reads as a known warning.
 */
export type PerDiemWarning =
  | { type: "two_rate_years"; message: string; years: string }
  | { type: "meals_exceed_days"; message: string }
  | { type: "other"; message: string };

/** `AppError.details.rule` of a computation error (`PerDiemError`) — the client picks the key from it (T003). */
export type PerDiemErrorRule =
  | "missing_rate"
  | "missing_meal_amounts"
  | "too_many_meals"
  | "too_many_nights"
  | "long_stay"
  | "not_a_count";
