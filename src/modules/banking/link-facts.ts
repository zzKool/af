// The link facts of bank rows (F113, F114): Σ allocations FROM each row, in the row's currency, and which rows sit
// in a transfer link — the facts the workbench, the Months panel and the sidebar's count derive the state from.
// Pure over linking's DTOs: a cross-currency link (D60) counts by the share of the row's base it took —
// linking's `rowRemaining`, the one rule. MUST NOT import from next/* or src/components/*.
import { Prisma } from "@/generated/prisma/browser";
import type { LinkDto } from "@/modules/linking";
import * as linking from "@/modules/linking";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** A row as the link facts need it: its amount and currency, its base (the share a cross-currency link took). */
export type RowForFacts = {
  id: string;
  amount: string | Dec;
  currency: string;
  amountBase: string | Dec | null;
};

export type LinkFacts = { allocated: Map<string, string>; transfer: Set<string> };

/**
 * Σ allocations FROM each row, in the row's currency, and which rows sit in a transfer link — the facts the
 * workbench, the Months panel and the sidebar's count derive the state from. A cross-currency link (F114, D60)
 * counts by the share of the row's base it took: linking's `rowRemaining`, the one rule.
 */
export function linkFactsOf(links: readonly LinkDto[], rows: readonly RowForFacts[]): LinkFacts {
  const usage = new Map<string, linking.RowUsage>();
  const transfer = new Set<string>();
  for (const l of links) {
    if (l.kind === "transfer") {
      if (l.from.type === "bank_transaction") transfer.add(l.from.id);
      if (l.to.type === "bank_transaction") transfer.add(l.to.id);
      continue;
    }
    if (
      l.from.type === "bank_transaction" &&
      l.allocatedAmount !== null &&
      linking.ALLOCATING_KINDS.includes(l.kind)
    ) {
      const u = usage.get(l.from.id) ?? { byCurrency: new Map(), base: new D(0) };
      const ccy = l.currency ?? "";
      const slot = u.byCurrency.get(ccy) ?? { amount: new D(0), base: new D(0) };
      slot.amount = slot.amount.plus(l.allocatedAmount);
      slot.base = slot.base.plus(l.allocatedBase ?? 0);
      u.byCurrency.set(ccy, slot);
      u.base = u.base.plus(l.allocatedBase ?? 0);
      usage.set(l.from.id, u);
    }
  }
  const allocated = new Map<string, string>();
  for (const r of rows) {
    const u = usage.get(r.id);
    if (!u) continue;
    allocated.set(r.id, new D(r.amount).abs().minus(linking.rowRemaining(r, u)).toFixed(2));
  }
  return { allocated, transfer };
}
