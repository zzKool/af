// The per-diem breakdown (D29: its own PDF document): what the print route renders and the job stores.
// MUST NOT import from next/* or src/components/*.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as expenses from "@/modules/expenses";
import * as settings from "@/modules/settings";
import { toLocal } from "./calculator";
import type { PerDiemResult } from "./types";

export type PerDiemStatement = {
  company: { name: string; orgNumber: string | null; address: string | null };
  group: string;
  expense: { key: string; amount: string; date: string } | null;
  trip: {
    departure: string;
    return: string;
    countryCode: string;
    agency: string | null;
  };
  result: PerDiemResult;
};

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export async function resolvePerDiemStatement(
  tx: TransactionClient,
  caller: CallerIdentity,
  groupId: string,
): Promise<PerDiemStatement | null> {
  const trip = await tx.trip.findUnique({ where: { groupId }, include: { group: true } });
  if (!trip || !trip.computed) return null;
  const [profile, expense] = await Promise.all([
    settings.getTenantProfile(tx, caller),
    trip.perDiemExpenseId ? expenses.getExpense(tx, trip.perDiemExpenseId) : Promise.resolve(null),
  ]);
  const dep = toLocal(trip.departureAt);
  const ret = toLocal(trip.returnAt);
  return {
    company: {
      name: profile.data?.name ?? "",
      orgNumber: profile.data?.orgNumber ?? null,
      address: profile.data?.address ?? null,
    },
    group: expenses.groupLabel(trip.group),
    expense: expense ? { key: expense.key, amount: expense.amount, date: expense.date } : null,
    trip: {
      departure: `${dep.date} ${clock(dep.minutes)}`,
      return: `${ret.date} ${clock(ret.minutes)}`,
      countryCode: trip.countryCode,
      agency: trip.agency,
    },
    result: trip.computed as PerDiemResult,
  };
}
