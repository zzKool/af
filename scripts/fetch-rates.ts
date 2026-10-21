// One-off: pull the last N ECB reference rates into `ecb_rates` without waiting for the 16:30 schedule.
//   DATABASE_URL=postgresql://… npx tsx scripts/fetch-rates.ts [lastN]      (default 400 ≈ 18 months of weekdays)
// The same fetch the `rates.ecb-sync` job runs; duplicates are skipped, so it is safe to repeat.
import { prisma } from "@/kernel/db/client";
import { fetchDailyRates } from "@/modules/rates/ecb-rates";

async function main() {
  const lastN = Math.max(1, Math.min(2000, Number(process.argv[2] ?? 400) || 400));
  const result = await fetchDailyRates(prisma, { lastN });
  console.log(
    `ECB rates: ${result.inserted} inserted, ${result.skipped} already stored (last ${lastN} observations)`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
