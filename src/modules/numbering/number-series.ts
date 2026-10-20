// number_series — gap-free counters (D5). The only writer of the table.
//
// `nextInSeries` is an upsert that bumps the row inside the CALLER's transaction: the row lock makes
// concurrent issuers queue, and a rollback of the surrounding transaction hands the number back.
// Hence the rule for callers: take the number in the same transaction that persists the numbered
// thing, and never before anything that can still fail validation.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import type { SeriesStatus } from "./types";

const SERIES_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

function assertSeriesKey(series: string): void {
  if (!SERIES_KEY.test(series)) throw new Error(`Invalid series key "${series}"`);
}

/**
 * The next number of `series` for the caller's tenant, starting at 1. Row-locked for the rest of the
 * transaction; the value is final only when the transaction commits.
 */
export async function nextInSeries(
  tx: TransactionClient,
  caller: Pick<CallerIdentity, "tenantId">,
  series: string,
): Promise<number> {
  assertSeriesKey(series);
  const rows = await tx.$queryRawUnsafe<{ value: number }[]>(
    `INSERT INTO number_series (tenant_id, series, next_value)
     VALUES ($1::uuid, $2, 2)
     ON CONFLICT (tenant_id, series)
     DO UPDATE SET next_value = number_series.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS value`,
    caller.tenantId,
    series,
  );
  return rows[0].value;
}

/** What the series would hand out next — a read, no lock, for previews ("will be VA26-004"). */
export async function peekSeries(
  tx: TransactionClient,
  series: string,
): Promise<ServiceResult<SeriesStatus>> {
  assertSeriesKey(series);
  const row = await tx.numberSeries.findFirst({ where: { series } });
  return {
    data: {
      series,
      nextValue: row?.nextValue ?? 1,
      lastIssued: row ? row.nextValue - 1 : 0,
      updatedAt: row?.updatedAt ?? null,
    },
  };
}
