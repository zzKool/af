// READ API of the subscriptions module (F94 FR-013, FR-014): the list on the DataTable contract, one subscription
// with its periods, the dashboard's attention counts. Every column is derived (one company has a few dozen
// subscriptions), so the list is computed in memory over the loaded set.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { filterInMemory, finishList } from "@/kernel/list-query/memory";
import { buildDateHierarchy, countDistinct } from "@/kernel/list-query/prisma";
import type {
  ColumnMap,
  DateHierarchy,
  DistinctValue,
  ListQuery,
  ListResult,
  SortSpec,
} from "@/kernel/list-query/types";
import { notFound } from "./errors";
import { type LoadedSubscription, loadSubscriptions } from "./facts";
import {
  ATTENTION_MARKS,
  type AttentionCounts,
  type PeriodView,
  type SubscriptionDetail,
  type SubscriptionListRow,
} from "./types";

export const SUBSCRIPTION_COLUMNS = {
  name: { type: "text", searchable: true },
  partnerName: { type: "enum", searchable: true },
  becomes: { type: "enum" },
  cadence: { type: "enum" },
  basCode: { type: "enum" },
  groupLabel: { type: "text" },
  paymentSourceLabel: { type: "enum" },
  startDate: { type: "date" },
  endDate: { type: "date" },
  active: { type: "boolean" },
  nextDate: { type: "date" },
  expectedAmount: { type: "money" },
  expectedCurrency: { type: "enum" },
  currentState: { type: "enum" },
  attention: { type: "number" },
} satisfies ColumnMap;
export type SubscriptionColumn = keyof typeof SUBSCRIPTION_COLUMNS;
export const SUBSCRIPTION_COLUMN_KEYS = Object.keys(SUBSCRIPTION_COLUMNS) as SubscriptionColumn[];
export const SUBSCRIPTION_DEFAULT_SORT: SortSpec[] = [
  { col: "active", dir: "desc" },
  { col: "nextDate", dir: "asc" },
  { col: "name", dir: "asc" },
];
const DERIVED = new Set(SUBSCRIPTION_COLUMN_KEYS);

export const hasAttention = (p: PeriodView) => p.marks.some((m) => ATTENTION_MARKS.includes(m));

export function toListRow(s: LoadedSubscription, today: string): SubscriptionListRow {
  const sub = s.subscription;
  const next = s.periods.find((p) => p.date >= today && !p.skipped) ?? null;
  const current = [...s.periods].reverse().find((p) => p.state !== "upcoming") ?? null;
  return {
    id: sub.id,
    name: sub.name,
    partnerId: sub.partnerId,
    partnerName: s.partnerName,
    becomes: sub.becomes,
    cadence: sub.cadence,
    basCode: sub.basCode,
    groupId: sub.groupId,
    groupLabel: s.groupLabel,
    paymentSourceLabel: s.paymentSourceLabel,
    startDate: sub.startDate,
    endDate: sub.endDate,
    active: sub.endDate === null || sub.endDate >= today,
    nextDate: next && (sub.endDate === null || next.date <= sub.endDate) ? next.date : null,
    expectedAmount: next?.price?.amount ?? null,
    expectedCurrency: next?.price?.currency ?? null,
    currentState: current?.state ?? null,
    attention: s.periods.filter(hasAttention).length,
  };
}

async function loadRows(
  tx: TransactionClient,
  caller: CallerIdentity,
  q: ListQuery,
  today: string,
  exceptColumn?: string,
): Promise<SubscriptionListRow[]> {
  const loaded = await loadSubscriptions(tx, caller, today);
  return filterInMemory(
    loaded.map((s) => toListRow(s, today)),
    q,
    SUBSCRIPTION_COLUMNS,
    {
      derived: DERIVED,
      exceptColumn,
      search: (row, term) => {
        const t = term.toLowerCase();
        return [row.name, row.partnerName, row.groupLabel].some((v) =>
          (v ?? "").toLowerCase().includes(t),
        );
      },
    },
  );
}

export async function listSubscriptions(
  tx: TransactionClient,
  caller: CallerIdentity,
  q: ListQuery,
  today: string,
): Promise<ListResult<SubscriptionListRow>> {
  const rows = await loadRows(tx, caller, q, today);
  return finishList(rows, q, SUBSCRIPTION_COLUMNS, SUBSCRIPTION_DEFAULT_SORT);
}

export async function distinctSubscriptionValues(
  tx: TransactionClient,
  caller: CallerIdentity,
  column: SubscriptionColumn,
  q: ListQuery,
  today: string,
): Promise<DistinctValue[]> {
  const rows = await loadRows(tx, caller, q, today, column);
  return countDistinct(
    rows.map((r) => r[column]),
    SUBSCRIPTION_COLUMNS[column],
  );
}

export async function subscriptionDateHierarchy(
  tx: TransactionClient,
  caller: CallerIdentity,
  column: "startDate" | "endDate" | "nextDate",
  q: ListQuery,
  today: string,
): Promise<DateHierarchy> {
  const rows = await loadRows(tx, caller, q, today, column);
  return buildDateHierarchy(rows.map((r) => r[column]));
}

/** One subscription with its periods, newest first (the next upcoming one on top). */
export async function getSubscriptionDetail(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string,
  today: string,
): Promise<ServiceResult<SubscriptionDetail>> {
  const [s] = await loadSubscriptions(tx, caller, today, [id]);
  if (!s) return { error: notFound("Subscription", id) };
  return {
    data: {
      subscription: s.subscription,
      partnerName: s.partnerName,
      groupLabel: s.groupLabel,
      paymentSourceLabel: s.paymentSourceLabel,
      prices: s.prices,
      pauses: s.pauses,
      periods: [...s.periods].reverse(),
    },
  };
}

/** The dashboard's to-do (US6): the periods that need the owner, with their three counts. */
export async function attentionCounts(
  tx: TransactionClient,
  caller: CallerIdentity,
  today: string,
): Promise<AttentionCounts> {
  const loaded = await loadSubscriptions(tx, caller, today);
  const out: AttentionCounts = { periods: 0, toConfirm: 0, chargeMissing: 0, documentMissing: 0 };
  for (const s of loaded)
    for (const p of s.periods) {
      if (!hasAttention(p)) continue;
      out.periods++;
      if (p.marks.includes("match_waiting")) out.toConfirm++;
      if (p.marks.includes("charge_missing")) out.chargeMissing++;
      if (p.marks.includes("receipt_missing") || p.marks.includes("bill_missing"))
        out.documentMissing++;
    }
  return out;
}
