// Read API of the traktamente module: the rate table, the trip of a group, the countries of a year.
import type { TransactionClient } from "@/kernel/db/tenant-client";

export { listRates, ratesForYears, rateYears } from "./rates";
export { getTrip, previewPerDiem } from "./trip";

export type CountryOption = { countryCode: string; name: string; dayAmount: string; year: number };

/** `Schweiz (1 402 SEK/day, 2026)` — the trip panel's country select, for the year of the departure. */
export async function countryOptions(
  tx: TransactionClient,
  year: number,
  locale: "sv" | "en" = "en",
): Promise<CountryOption[]> {
  const rows = await tx.normalbelopp.findMany({
    where: { year },
    orderBy: { countryNameSv: "asc" },
    select: {
      countryCode: true,
      countryNameSv: true,
      countryNameEn: true,
      dayAmount: true,
      year: true,
    },
  });
  return rows.map((r) => ({
    countryCode: r.countryCode,
    name: (locale === "en" ? r.countryNameEn : null) ?? r.countryNameSv,
    dayAmount: r.dayAmount.toFixed(2),
    year: r.year,
  }));
}
