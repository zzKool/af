"use client";

// The trip panel on the group page (specs/traktamente FR-006): date-times, country (with the year's amount),
// agency, the meal counts, nights / long stay collapsed, the live result card, "Create per-diem expense".
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { CountryOption } from "@/modules/traktamente/queries";
import {
  countryOptionsAction,
  createPerDiemExpenseAction,
  upsertTripAction,
} from "@/modules/traktamente/traktamente.actions";
import type { PerDiemResult, TripDto } from "@/modules/traktamente/types";
import { computeErrorText, reasonText, warningText } from "./per-diem-text";

export type TripView = Omit<TripDto, "departureAt" | "returnAt" | "createdAt" | "updatedAt"> & {
  /** local `YYYY-MM-DDTHH:mm` in the tenant zone */
  departureAt: string;
  returnAt: string;
};

const sek = (v: string) => `${formatCurrency(v, "SEK")} SEK`;

type ServerError = { message: string; details?: Record<string, string | number> };

/** The action's returned `AppError` (with its facts), else the transport error's message. */
function actionError(r: unknown): ServerError | null {
  const returned = (r as { data?: { error?: ServerError } } | undefined)?.data?.error;
  if (returned) return returned;
  const message = extractError(r);
  return message ? { message } : null;
}

export function TripPanel({
  groupId,
  trip,
  countries: initialCountries,
  categories,
  perDiemExpense,
  canWrite,
  locale,
}: {
  groupId: string;
  trip: TripView | null;
  countries: CountryOption[];
  categories: { code: string; label: string }[];
  /** the trip's per-diem expense; its category is fixed once written (the key carries the BAS alias) */
  perDiemExpense: { id: string; key: string; amount: string; basCode: string } | null;
  canWrite: boolean;
  locale: "en" | "fr" | null;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [departureAt, setDepartureAt] = useState(trip?.departureAt ?? "");
  const [returnAt, setReturnAt] = useState(trip?.returnAt ?? "");
  const [countryCode, setCountryCode] = useState(
    trip?.countryCode ?? initialCountries[0]?.countryCode ?? "",
  );
  const [agency, setAgency] = useState(trip?.agency ?? "");
  const [breakfasts, setBreakfasts] = useState(trip?.breakfasts ?? 0);
  const [lunches, setLunches] = useState(trip?.lunches ?? 0);
  const [dinners, setDinners] = useState(trip?.dinners ?? 0);
  const [nights, setNights] = useState(trip?.nightsWithoutPaidLodging ?? 0);
  const [longStay, setLongStay] = useState(trip?.longStayFactor ?? "");
  const [more, setMore] = useState(false);
  const [countries, setCountries] = useState(initialCountries);
  const [result, setResult] = useState<PerDiemResult | null>(trip?.computed ?? null);
  const [computeError, setComputeError] = useState<ServerError | null>(null);
  // the travel category by default: the one aliased `Tr`, else the 58x group, else the first
  const [basCode, setBasCode] = useState(
    categories.find((c) => /\(Tr\)$/.test(c.label))?.code ??
      categories.find((c) => c.code.startsWith("58"))?.code ??
      categories[0]?.code ??
      "",
  );
  const { executeAsync: save, isPending: saving } = useAction(upsertTripAction);
  const { executeAsync: write, isPending: writing } = useAction(createPerDiemExpenseAction);
  const { executeAsync: loadCountries } = useAction(countryOptionsAction);

  // the departure year picks the rate rows the country select shows
  const year = Number(departureAt.slice(0, 4)) || new Date().getFullYear();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await loadCountries({ year, locale: locale === "fr" ? "en" : "en" });
      if (cancelled) return;
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (d) setCountries(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [year, locale, loadCountries]);

  async function submit() {
    const r = await save({
      groupId,
      departureAt,
      returnAt,
      countryCode,
      agency: agency.trim() || null,
      breakfasts,
      lunches,
      dinners,
      nightsWithoutPaidLodging: nights,
      longStayFactor: longStay.trim() || null,
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    toast.success(t("traktamente.trip.saved"));
    setResult(d?.trip.computed ?? null);
    setComputeError(d?.computeError ?? null);
    router.refresh();
  }

  async function writeExpense() {
    const r = await write({ groupId, basCode: perDiemExpense?.basCode ?? basCode });
    const error = actionError(r);
    if (error) {
      toast.error(computeErrorText(t, error));
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) {
      toast.success(
        t("traktamente.trip.expenseWritten", { key: d.expense.key, amount: d.expense.amount }),
      );
      setResult(d.trip.computed ?? null);
    }
    router.refresh();
  }

  const country = countries.find((c) => c.countryCode === countryCode);

  return (
    <section className="rounded-md border p-4" data-testid="trip-panel">
      <div className="mb-3">
        <h2 className="text-sm font-medium">{t("traktamente.trip.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("traktamente.trip.description")}</p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <label htmlFor={`${ids}-dep`} className="mb-1 block text-xs font-medium">
            {t("traktamente.trip.departure")}
          </label>
          <Input
            id={`${ids}-dep`}
            type="datetime-local"
            value={departureAt}
            onChange={(e) => setDepartureAt(e.target.value)}
            disabled={!canWrite}
            required
          />
        </div>
        <div>
          <label htmlFor={`${ids}-ret`} className="mb-1 block text-xs font-medium">
            {t("traktamente.trip.return")}
          </label>
          <Input
            id={`${ids}-ret`}
            type="datetime-local"
            value={returnAt}
            onChange={(e) => setReturnAt(e.target.value)}
            disabled={!canWrite}
            required
          />
        </div>
        <div>
          <label htmlFor={`${ids}-country`} className="mb-1 block text-xs font-medium">
            {t("traktamente.trip.country")}
          </label>
          <Select
            value={countryCode}
            onValueChange={(v) => v && setCountryCode(v)}
            disabled={!canWrite}
          >
            <SelectTrigger id={`${ids}-country`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(countries.some((c) => c.countryCode === countryCode) || !countryCode
                ? countries
                : [{ countryCode, name: countryCode, dayAmount: "0", year }, ...countries]
              ).map((c) => (
                <SelectItem key={c.countryCode} value={c.countryCode}>
                  {c.name} ({c.countryCode}) — {formatCurrency(c.dayAmount, "SEK")} SEK/day,{" "}
                  {c.year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {countries.length === 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {t("traktamente.noYears")}{" "}
              <Link href="/settings/traktamente" className="underline">
                {t("traktamente.trip.rateLink")}
              </Link>
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`${ids}-agency`} className="mb-1 block text-xs font-medium">
            {t("traktamente.trip.agency")}
          </label>
          <Input
            id={`${ids}-agency`}
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          {(
            [
              ["breakfasts", breakfasts, setBreakfasts],
              ["lunches", lunches, setLunches],
              ["dinners", dinners, setDinners],
            ] as const
          ).map(([key, value, set]) => (
            <div key={key}>
              <label htmlFor={`${ids}-${key}`} className="mb-1 block text-xs font-medium">
                {t(`traktamente.trip.${key}`)}
              </label>
              <Input
                id={`${ids}-${key}`}
                type="number"
                min={0}
                step={1}
                value={value}
                onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
                disabled={!canWrite}
                data-testid={`trip-${key}`}
              />
            </div>
          ))}
        </div>
        <div className="sm:col-span-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setMore((m) => !m)}
          >
            {t("traktamente.trip.more")}
          </button>
          {more && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${ids}-nights`} className="mb-1 block text-xs font-medium">
                  {t("traktamente.trip.nights")}
                </label>
                <Input
                  id={`${ids}-nights`}
                  type="number"
                  min={0}
                  step={1}
                  value={nights}
                  onChange={(e) => setNights(Math.max(0, Number(e.target.value) || 0))}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <label htmlFor={`${ids}-long`} className="mb-1 block text-xs font-medium">
                  {t("traktamente.trip.longStay")}
                </label>
                <Input
                  id={`${ids}-long`}
                  inputMode="decimal"
                  placeholder="0.7"
                  value={longStay}
                  onChange={(e) => setLongStay(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
            </div>
          )}
        </div>
        {canWrite && (
          <div className="flex justify-end sm:col-span-2">
            <Button
              type="submit"
              size="sm"
              disabled={saving || !departureAt || !returnAt || !countryCode}
              data-testid="save-trip"
            >
              {t("traktamente.trip.save")}
            </Button>
          </div>
        )}
      </form>

      {computeError && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400" data-testid="trip-error">
          {computeErrorText(t, computeError)}{" "}
          <Link href="/settings/traktamente" className="underline">
            {t("traktamente.trip.rateLink")}
          </Link>
        </p>
      )}
      {result && (
        <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm" data-testid="trip-result">
          {result.reason ? (
            <p>{t("traktamente.trip.nothing", { reason: reasonText(t, result.reason) })}</p>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              <dt className="col-span-2 font-medium" data-testid="trip-days">
                {t("traktamente.trip.result", {
                  days: result.days,
                  full: result.fullDays,
                  half: result.halfDays,
                  nights: result.nights,
                })}
                {country ? ` · ${country.name}` : ""}
              </dt>
              <dt className="text-muted-foreground">{t("traktamente.trip.dayTotal")}</dt>
              <dd className="text-right tabular-nums">{sek(result.dayTotal)}</dd>
              {result.meals.deduction !== "0.00" && (
                <>
                  <dt className="text-muted-foreground">
                    {t("traktamente.trip.meals")} ({result.meals.breakfasts}/{result.meals.lunches}/
                    {result.meals.dinners})
                  </dt>
                  <dd className="text-right tabular-nums">−{sek(result.meals.deduction)}</dd>
                </>
              )}
              {result.nightAllowance.nights > 0 && (
                <>
                  <dt className="text-muted-foreground">{t("traktamente.trip.nightTotal")}</dt>
                  <dd className="text-right tabular-nums">{sek(result.nightAllowance.total)}</dd>
                </>
              )}
              <dt className="font-medium">{t("traktamente.trip.total")}</dt>
              <dd className="text-right font-medium tabular-nums" data-testid="trip-total">
                {sek(result.total)}
              </dd>
              {result.warnings.map((w) => (
                <dd key={w.message} className="col-span-2 text-xs text-muted-foreground">
                  {warningText(t, w)}
                </dd>
              ))}
            </dl>
          )}
          {canWrite && !result.reason && Number(result.total) > 0 && (
            <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
              {perDiemExpense ? (
                // the replace keeps the expense's category — a select here would be ignored (T002)
                <div className="min-w-48">
                  <div className="mb-1 text-xs font-medium">{t("traktamente.trip.category")}</div>
                  <p className="text-sm" data-testid="per-diem-category">
                    {categories.find((c) => c.code === perDiemExpense.basCode)?.label ??
                      perDiemExpense.basCode}
                  </p>
                </div>
              ) : (
                <div className="min-w-48">
                  <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
                    {t("traktamente.trip.category")}
                  </label>
                  <Select value={basCode} onValueChange={(v) => v && setBasCode(v)}>
                    <SelectTrigger id={`${ids}-cat`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                size="sm"
                onClick={() => void writeExpense()}
                disabled={writing || !basCode}
                data-testid="write-per-diem"
              >
                {perDiemExpense
                  ? t("traktamente.trip.recompute")
                  : t("traktamente.trip.createExpense")}
              </Button>
            </div>
          )}
          {perDiemExpense && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="per-diem-expense">
              {t("traktamente.trip.expenseLink")}:{" "}
              <span className="font-mono">{perDiemExpense.key}</span> · {sek(perDiemExpense.amount)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
