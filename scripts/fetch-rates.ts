// One-off: pull ECB reference rates into `ecb_rates` without waiting for the 16:30 schedule.
//   DATABASE_URL=postgresql://… npx tsx scripts/fetch-rates.ts 2023-04-01   backfill from that day to today (Stockholm)
//   DATABASE_URL=postgresql://… npx tsx scripts/fetch-rates.ts [lastN]      last N observations (default 400 ≈ 18 months of weekdays)
// The same fetch the `rates.ecb-sync` job runs; duplicates are skipped, so it is safe to repeat.
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { fetchDailyRates, fetchRatesArgToOptions } from "@/modules/rates/ecb-rates";

async function main() {
  const arg = process.argv[2];
  // the Stockholm day, like every other "today" in the app — not the UTC one (V8)
  const options = fetchRatesArgToOptions(arg, createClock().today());
  if (!options) {
    console.error(
      `Expected a past day (yyyy-mm-dd) or a number of observations, got "${arg}".\n` +
        "Usage: npx tsx scripts/fetch-rates.ts [yyyy-mm-dd | lastN]",
    );
    process.exitCode = 1;
    return;
  }
  const result = await fetchDailyRates(prisma, options);
  const scope =
    "startDate" in options ? `from ${options.startDate}` : `last ${options.lastN} observations`;
  console.log(
    `ECB rates: ${result.inserted} inserted, ${result.skipped} already stored (${scope})`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
