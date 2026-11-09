"use client";

// A new trip, in place (review 2026-10-31 §5.2, T020): the three facts a trip needs — departure, return (local
// date-times in the tenant zone, as the trip panel takes them) and the country of the year's rates — for a host that
// creates a trip group without leaving its screen (the reading dialog's *+ New group*). `useCreateTripGroup` writes
// the group and its trip in one action on the host's submit, so cancelling the host leaves nothing behind; the
// per-diem is computed with it, the meals and the per-diem expense stay the group page's (the trip panel).
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import type { CountryOption } from "@/modules/traktamente/queries";
import {
  countryOptionsAction,
  createTripGroupAction,
} from "@/modules/traktamente/traktamente.actions";

export type NewTrip = {
  /** local `YYYY-MM-DDTHH:mm` */
  departureAt: string;
  returnAt: string;
  /** ISO 3166 alpha-2, empty until picked */
  countryCode: string;
};

/** A trip starting and ending on the paper's day — the owner moves the two ends; no country until he picks one. */
export function newTripFor(day: string): NewTrip {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
  return { departureAt: d ? `${d}T08:00` : "", returnAt: d ? `${d}T18:00` : "", countryCode: "" };
}

/** What the trip still needs before it can be created (the host greys its button and names them). */
export function newTripMissing(trip: NewTrip): ("departure" | "return" | "country")[] {
  return [
    ...(trip.departureAt.length < 16 ? (["departure"] as const) : []),
    ...(trip.returnAt.length < 16 || trip.returnAt <= trip.departureAt
      ? (["return"] as const)
      : []),
    ...(!/^[A-Z]{2}$/.test(trip.countryCode) ? (["country"] as const) : []),
  ];
}

/** Three cells of the host's two-column grid: departure, return, the country of the departure year's rates. */
export function NewTripFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: NewTrip;
  onChange: (trip: NewTrip) => void;
}) {
  const t = useT();
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const { executeAsync: loadCountries } = useAction(countryOptionsAction);
  // the departure year picks the rate rows the country select shows (the trip panel's rule)
  const year = Number(value.departureAt.slice(0, 4)) || new Date().getFullYear();
  useEffect(() => {
    let live = true;
    void loadCountries({ year, locale: "en" }).then((r) => {
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (live && d) setCountries(d);
    });
    return () => {
      live = false;
    };
  }, [year, loadCountries]);

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-dep`} className="mb-1 block text-xs font-medium">
          {t("traktamente.trip.departure")}
        </label>
        <Input
          id={`${idPrefix}-dep`}
          type="datetime-local"
          value={value.departureAt}
          onChange={(e) => onChange({ ...value, departureAt: e.target.value })}
          data-testid="new-trip-departure"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-ret`} className="mb-1 block text-xs font-medium">
          {t("traktamente.trip.return")}
        </label>
        <Input
          id={`${idPrefix}-ret`}
          type="datetime-local"
          value={value.returnAt}
          onChange={(e) => onChange({ ...value, returnAt: e.target.value })}
          data-testid="new-trip-return"
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-country`} className="mb-1 block text-xs font-medium">
          {t("traktamente.trip.country")}
        </label>
        <Select
          value={value.countryCode || undefined}
          onValueChange={(v) => v && onChange({ ...value, countryCode: v })}
        >
          <SelectTrigger
            id={`${idPrefix}-country`}
            className="w-full"
            data-testid="new-trip-country"
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {countries.map((c) => (
              <SelectItem key={c.countryCode} value={c.countryCode}>
                {c.name} ({c.countryCode})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          {countries.length === 0
            ? t("traktamente.noYears")
            : t("traktamente.newTrip.hint", { year: String(year) })}
        </p>
      </div>
    </>
  );
}

/**
 * On the host's submit: the new trip group's id — the group and its trip in one action, the per-diem computed with
 * it — or `null` when the creation failed (the error is toasted). A trip saved without a computation (a year without
 * rates) is created all the same; the toast says what is missing.
 */
export function useCreateTripGroup() {
  const t = useT();
  const { executeAsync, isPending } = useAction(createTripGroupAction);
  async function createTrip(description: string, trip: NewTrip): Promise<string | null> {
    const r = await executeAsync({ description: description.trim(), ...trip });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return null;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return null;
    const label = `${d.group.number} — ${d.group.description}`;
    if (d.computeError) toast.warning(t("traktamente.newTrip.noRates", { group: label }));
    else
      toast.success(
        t("traktamente.newTrip.created", {
          group: label,
          days: String(d.trip.computed?.days ?? 0),
        }),
      );
    return d.group.id;
  }
  return { createTrip, isPending };
}
