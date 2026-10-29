// What stage 1 of the proposals reads about bank rows (F98, specs/ai FR-004) — banking's own data, served to
// modules/linking (which owns the proposals): the rows still missing a category or a partner, the first active
// rule that would categorise them, the partner's default category, and the owner's history for the same
// counterparty key. Read only: nothing here writes.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as partners from "@/modules/partners";
import { bankText, firstHit, orderRules, type RuleLike, ruleTarget } from "./rules";

/** A row that could still get a proposal: not categorised by hand, and missing a category or a partner. */
export type ProposalRow = {
  id: string;
  bookingDate: string;
  amount: string;
  currency: string;
  counterpartyKey: string;
  /** the five text columns joined — what the model reads in PR 2 */
  text: string;
  basCode: string | null;
  partnerId: string | null;
  categorisedBy: "rule" | null;
};

export type RuleSuggestion = {
  ruleId: string;
  ruleName: string;
  basCode: string | null;
  partnerId: string | null;
};

/** The owner's history for one counterparty key: what he set by hand on its other rows, most frequent first. */
export type CategoryMemory = {
  bas: { code: string; n: number }[];
  partner: { id: string; n: number }[];
};

export type ProposalInput = {
  row: ProposalRow;
  /** the first active rule (in run order) that matches the row and would set a category or a partner */
  rule: RuleSuggestion | null;
  /** the row's partner's default category, when the row has a partner */
  partnerDefault: string | null;
  memory: CategoryMemory;
};

const OPEN_WHERE = {
  OR: [{ categorisedBy: null }, { categorisedBy: "rule" as const }],
  AND: [{ OR: [{ basCode: null }, { partnerId: null }] }],
};

/** The rows a proposal run looks at: of one import, or these ids, or (nightly) every open one — newest first. */
export async function proposalRowIds(
  tx: TransactionClient,
  scope: { importId: string } | { transactionIds: string[] } | { all: true },
  limit = 5_000,
): Promise<string[]> {
  const where =
    "importId" in scope
      ? { ...OPEN_WHERE, bankImportId: scope.importId }
      : "transactionIds" in scope
        ? { ...OPEN_WHERE, id: { in: scope.transactionIds } }
        : OPEN_WHERE;
  const rows = await tx.bankTransaction.findMany({
    where,
    select: { id: true },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map((r) => r.id);
}

/** Every input stage 1 needs for these rows, in four reads (rows, rules, partners, history). */
export async function proposalInputs(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<ProposalInput[]> {
  if (ids.length === 0) return [];
  const rows = await tx.bankTransaction.findMany({
    where: { id: { in: [...ids] }, ...OPEN_WHERE },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
  });
  if (rows.length === 0) return [];

  const rules = orderRules(
    (await tx.categorisationRule.findMany({ where: { isActive: true } })).filter(
      (r) => r.basCode !== null || r.partnerId !== null,
    ) as (RuleLike & { name: string; basCode: string | null; partnerId: string | null })[],
  );
  const partnerList = (await partners.getPartners(tx, {})).data ?? [];
  const defaults = new Map(partnerList.map((p) => [p.id, p.defaultBasCategoryCode ?? null]));
  const memory = await categoryMemory(
    tx,
    rows.map((r) => r.counterpartyKey),
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const hit = firstHit(rules, ruleTarget(r).text);
    const rule: RuleSuggestion | null = hit
      ? {
          ruleId: hit.id,
          ruleName: hit.name,
          basCode: hit.basCode ?? (hit.partnerId ? (defaults.get(hit.partnerId) ?? null) : null),
          partnerId: hit.partnerId,
        }
      : null;
    return {
      row: {
        id: r.id,
        bookingDate: r.bookingDate.toISOString().slice(0, 10),
        amount: r.amount.toFixed(2),
        currency: r.currency,
        counterpartyKey: r.counterpartyKey,
        text: bankText(r),
        basCode: r.basCode,
        partnerId: r.partnerId,
        categorisedBy: r.categorisedBy === "rule" ? "rule" : null,
      },
      rule,
      partnerDefault: r.partnerId ? (defaults.get(r.partnerId) ?? null) : null,
      memory: memory.get(r.counterpartyKey) ?? { bas: [], partner: [] },
    };
  });
}

/**
 * Per counterparty key, what the owner set **by hand** on the key's rows (`categorised_by = manual`) — the
 * category and the partner, counted, most frequent first (ties: the code / id, for a stable order). The rows
 * being proposed for are left out, so a row never remembers itself.
 */
export async function categoryMemory(
  tx: TransactionClient,
  keys: readonly string[],
  excludeIds: readonly string[] = [],
): Promise<Map<string, CategoryMemory>> {
  const wanted = [...new Set(keys.filter((k) => k.trim() !== ""))];
  const out = new Map<string, CategoryMemory>();
  if (wanted.length === 0) return out;
  const where = {
    counterpartyKey: { in: wanted },
    categorisedBy: "manual" as const,
    ...(excludeIds.length ? { id: { notIn: [...excludeIds] } } : {}),
  };
  // one after the other: one transaction client (F53)
  const bas = await tx.bankTransaction.groupBy({
    by: ["counterpartyKey", "basCode"],
    where: { ...where, basCode: { not: null } },
    _count: { _all: true },
  });
  const partner = await tx.bankTransaction.groupBy({
    by: ["counterpartyKey", "partnerId"],
    where: { ...where, partnerId: { not: null } },
    _count: { _all: true },
  });
  const entry = (key: string) => {
    let m = out.get(key);
    if (!m) {
      m = { bas: [], partner: [] };
      out.set(key, m);
    }
    return m;
  };
  for (const g of bas)
    if (g.basCode) entry(g.counterpartyKey).bas.push({ code: g.basCode, n: g._count._all });
  for (const g of partner)
    if (g.partnerId) entry(g.counterpartyKey).partner.push({ id: g.partnerId, n: g._count._all });
  for (const m of out.values()) {
    m.bas.sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
    m.partner.sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  }
  return out;
}
