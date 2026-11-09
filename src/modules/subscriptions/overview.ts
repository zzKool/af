// The subscriptions page's hero (F164, Pulse everywhere): what the running subscriptions cost a month in the base
// (a yearly one counts a twelfth), a year of them, who takes the most, the next charges, and the periods with a
// to-do. Pure over the list's own rows and a rate per currency (the page reads today's ECB rate) — nothing stored.
import { Prisma } from "@/generated/prisma/browser";
import type { SubscriptionListRow } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type SubscriptionsOverview = {
  active: number;
  /** Σ monthly equivalents of the active subscriptions with an expected price, in the base */
  perMonth: string;
  perYear: string;
  /** subscriptions left out of the sums: no expected price, or no rate for its currency today */
  unpriced: number;
  vendors: { name: string; perMonth: string }[];
  others: string;
  next: { name: string; date: string; amount: string | null; currency: string | null }[];
  attention: number;
};

export function subscriptionsOverviewFrom(
  rows: readonly Pick<
    SubscriptionListRow,
    | "name"
    | "partnerName"
    | "active"
    | "cadence"
    | "expectedAmount"
    | "expectedCurrency"
    | "nextDate"
    | "attention"
  >[],
  rateOf: (currency: string) => string | null,
  top = 5,
): SubscriptionsOverview {
  const active = rows.filter((r) => r.active);
  let unpriced = 0;
  const byVendor = new Map<string, Dec>();
  let total = new D(0);
  for (const r of active) {
    const rate = r.expectedCurrency ? rateOf(r.expectedCurrency) : null;
    if (!r.expectedAmount || rate === null) {
      unpriced += 1;
      continue;
    }
    const monthly = new D(r.expectedAmount).mul(rate).div(r.cadence === "yearly" ? 12 : 1);
    total = total.plus(monthly);
    const who = r.partnerName ?? r.name;
    byVendor.set(who, (byVendor.get(who) ?? new D(0)).plus(monthly));
  }
  const ranked = [...byVendor.entries()].sort((a, b) => b[1].comparedTo(a[1]));
  return {
    active: active.length,
    perMonth: total.toFixed(2),
    perYear: total.mul(12).toFixed(2),
    unpriced,
    vendors: ranked.slice(0, top).map(([name, v]) => ({ name, perMonth: v.toFixed(2) })),
    others: ranked
      .slice(top)
      .reduce((s, [, v]) => s.plus(v), new D(0))
      .toFixed(2),
    next: active
      .filter((r) => r.nextDate)
      .sort((a, b) => (a.nextDate as string).localeCompare(b.nextDate as string))
      .slice(0, 4)
      .map((r) => ({
        name: r.partnerName ?? r.name,
        date: r.nextDate as string,
        amount: r.expectedAmount,
        currency: r.expectedCurrency,
      })),
    attention: rows.reduce((s, r) => s + r.attention, 0),
  };
}
