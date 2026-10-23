// The breakdown's server words in the reader's language (T003): the reason, the warnings, the computation error.
// Services keep English + facts (ui-conventions); this picks the key. Shared by the panel and the printed sheet.
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import { NO_OVERNIGHT } from "@/modules/traktamente/calculator";
import type { PerDiemErrorRule, PerDiemWarning } from "@/modules/traktamente/types";

type T = (key: MessageKey, params?: MessageParams) => string;

const MEAL_LABEL: Record<string, MessageKey> = {
  breakfasts: "traktamente.trip.breakfasts",
  lunches: "traktamente.trip.lunches",
  dinners: "traktamente.trip.dinners",
};

/** Why nothing is tax-free — a reason the calculator does not name stays as written. */
export function reasonText(t: T, reason: string): string {
  return reason === NO_OVERNIGHT ? t("traktamente.trip.reason.noOvernight") : reason;
}

export function warningText(t: T, w: PerDiemWarning): string {
  switch (w.type) {
    case "two_rate_years":
      return t("traktamente.trip.warning.twoRateYears", { years: w.years });
    case "meals_exceed_days":
      return t("traktamente.trip.warning.mealsExceedDays");
    default:
      return w.message;
  }
}

/** A computation error (`AppError` from the calculator) by its rule; anything else keeps its message. */
export function computeErrorText(
  t: T,
  error: { message: string; details?: Record<string, string | number> },
): string {
  const d = error.details ?? {};
  switch (d.rule as PerDiemErrorRule | undefined) {
    case "missing_rate":
      return t("traktamente.trip.error.missingRate", {
        countryCode: d.countryCode ?? "",
        year: d.year ?? "",
      });
    case "missing_meal_amounts":
      return t("traktamente.trip.error.missingMealAmounts", { year: d.year ?? "" });
    case "too_many_meals": {
      const label = MEAL_LABEL[String(d.meal)];
      if (!label) return error.message;
      return t("traktamente.trip.error.tooManyMeals", {
        what: t(label),
        count: d.count ?? "",
        days: d.days ?? "",
      });
    }
    case "too_many_nights":
      return t("traktamente.trip.error.tooManyNights", {
        count: d.count ?? "",
        nights: d.nights ?? "",
      });
    case "long_stay":
      return t("traktamente.trip.error.longStay");
    default:
      return error.message;
  }
}
