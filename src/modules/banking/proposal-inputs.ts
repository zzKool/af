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

/** A row the owner categorised by hand — an example the model reads (F98 PR 2, FR-201). */
export type ConfirmedExample = { text: string; amount: string; currency: string; basCode: string };
export type ConfirmedExampleRow = ConfirmedExample & { id: string };

/** The owner's own categorised rows (`categorised_by = manual`), newest first — the pool examples are picked from. */
export async function confirmedExampleRows(
  tx: TransactionClient,
  take = 500,
): Promise<ConfirmedExampleRow[]> {
  const rows = await tx.bankTransaction.findMany({
    where: { categorisedBy: "manual", basCode: { not: null } },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    text: bankText(r),
    amount: r.amount.toFixed(2),
    currency: r.currency,
    basCode: r.basCode as string,
  }));
}

/**
 * The newest row per BAS code, at most `limit` codes — so the examples cover different accounts rather than one
 * busy counterparty. `excludeId`: the row being asked about never serves as its own example (the eval). Pure.
 */
export function pickExamples(
  rows: readonly ConfirmedExampleRow[],
  limit = 8,
  excludeId?: string,
): ConfirmedExample[] {
  const out: ConfirmedExample[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.id === excludeId || seen.has(r.basCode)) continue;
    seen.add(r.basCode);
    out.push({ text: r.text, amount: r.amount, currency: r.currency, basCode: r.basCode });
    if (out.length >= limit) break;
  }
  return out;
}

/** The model's examples for a run (F98 PR 2): `pickExamples` over the owner's categorised rows. */
export async function confirmedExamples(
  tx: TransactionClient,
  limit = 8,
): Promise<ConfirmedExample[]> {
  return pickExamples(await confirmedExampleRows(tx), limit);
}

/**
 * The eval's replay (F98 PR 2, FR-010): the rows the owner categorised by hand since a day, each as stage 1 would
 * have seen it before he did — category off, his own row taken out of the history (leave one out). The partner
 * stays as he set it. The truth (his code) comes back beside each input. Read only.
 */
export async function proposalReplayInputs(
  tx: TransactionClient,
  opts: { since: string; limit?: number },
): Promise<{ input: ProposalInput; truth: string }[]> {
  const rows = await tx.bankTransaction.findMany({
    where: {
      categorisedBy: "manual",
      basCode: { not: null },
      bookingDate: { gte: new Date(`${opts.since}T00:00:00Z`) },
    },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: opts.limit ?? 1_000,
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
  );
  return rows.map((r) => {
    const hit = firstHit(rules, ruleTarget(r).text);
    const own = memory.get(r.counterpartyKey) ?? { bas: [], partner: [] };
    // leave one out: the row's own vote is not its history
    const minus = <T extends { n: number }>(list: T[], self: (x: T) => boolean) =>
      list
        .map((x) => (self(x) ? { ...x, n: x.n - 1 } : x))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);
    return {
      truth: r.basCode as string,
      input: {
        row: {
          id: r.id,
          bookingDate: r.bookingDate.toISOString().slice(0, 10),
          amount: r.amount.toFixed(2),
          currency: r.currency,
          counterpartyKey: r.counterpartyKey,
          text: bankText(r),
          basCode: null,
          partnerId: r.partnerId,
          categorisedBy: null,
        },
        rule: hit
          ? {
              ruleId: hit.id,
              ruleName: hit.name,
              basCode:
                hit.basCode ?? (hit.partnerId ? (defaults.get(hit.partnerId) ?? null) : null),
              partnerId: hit.partnerId,
            }
          : null,
        partnerDefault: r.partnerId ? (defaults.get(r.partnerId) ?? null) : null,
        memory: {
          bas: minus(own.bas, (x) => x.code === r.basCode),
          partner: minus(own.partner, (x) => x.id === r.partnerId),
        },
      },
    };
  });
}
