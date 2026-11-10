// What stage 1 of the proposals reads about bank rows (F98, specs/ai FR-004) — banking's own data, served to
// modules/linking (which owns the proposals): the rows still missing a category or a partner, the first active
// rule that would categorise them, the partner's default category, and the owner's history for the same
// counterparty key. Read only: nothing here writes.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as partners from "@/modules/partners";
import { learnedRows } from "./learned";
import { rowFacts } from "./queries";
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

const OPEN_SELECT = {
  id: true,
  amount: true,
  currency: true,
  amountBase: true,
  partnerId: true,
  basCode: true,
  categorisedBy: true,
} as const;

/**
 * The rows a proposal run looks at: of one import, or these ids, or (nightly) every open one — newest first. A row
 * whose category or partner is derived from its proof lacks nothing (F129): it is left out, as a typed one is.
 */
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
    select: OPEN_SELECT,
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  const facts = await rowFacts(tx, rows);
  return rows
    .filter((r) => {
      const e = facts.effective.get(r.id);
      return !e || e.basCode === null || e.partnerId === null;
    })
    .map((r) => r.id);
}

/** Every input stage 1 needs for these rows, in four reads (rows, rules, partners, history). */
export async function proposalInputs(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<ProposalInput[]> {
  if (ids.length === 0) return [];
  const all = await tx.bankTransaction.findMany({
    where: { id: { in: [...ids] }, ...OPEN_WHERE },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
  });
  // the effective facts (F129): what the proof gives the row counts as there
  const facts = await rowFacts(tx, all);
  const effective = (id: string) => facts.effective.get(id);
  const rows = all.filter((r) => {
    const e = effective(r.id);
    return !e || e.basCode === null || e.partnerId === null;
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
    const basCode = effective(r.id)?.basCode ?? r.basCode;
    const partnerId = effective(r.id)?.partnerId ?? r.partnerId;
    return {
      row: {
        id: r.id,
        bookingDate: r.bookingDate.toISOString().slice(0, 10),
        amount: r.amount.toFixed(2),
        currency: r.currency,
        counterpartyKey: r.counterpartyKey,
        text: bankText(r),
        basCode,
        partnerId,
        categorisedBy: r.categorisedBy === "rule" ? "rule" : null,
      },
      rule,
      partnerDefault: partnerId ? (defaults.get(partnerId) ?? null) : null,
      memory: memory.get(r.counterpartyKey) ?? { bas: [], partner: [] },
    };
  });
}

/**
 * Per counterparty key, what the key's rows teach (`learnedRows`, D82): the category and the partner the owner set
 * **by hand** or his **proof** gives (a justified row types nothing since T028 — its facts are the proof's), counted,
 * most frequent first (ties: the code / id, for a stable order). A rule's values never count. The rows being
 * proposed for are left out, so a row never remembers itself.
 */
export async function categoryMemory(
  tx: TransactionClient,
  keys: readonly string[],
  excludeIds: readonly string[] = [],
): Promise<Map<string, CategoryMemory>> {
  const wanted = [...new Set(keys.filter((k) => k.trim() !== ""))];
  const out = new Map<string, CategoryMemory>();
  if (wanted.length === 0) return out;
  const rows = await learnedRows(tx, {
    counterpartyKey: { in: wanted },
    ...(excludeIds.length ? { id: { notIn: [...excludeIds] } } : {}),
  });
  const bas = new Map<string, Map<string, number>>();
  const partner = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, key: string, v: string) => {
    const inner = m.get(key) ?? new Map<string, number>();
    inner.set(v, (inner.get(v) ?? 0) + 1);
    m.set(key, inner);
  };
  for (const r of rows) {
    if (r.learned.basCode) bump(bas, r.counterpartyKey, r.learned.basCode);
    if (r.learned.partnerId) bump(partner, r.counterpartyKey, r.learned.partnerId);
  }
  const entry = (key: string) => {
    let m = out.get(key);
    if (!m) {
      m = { bas: [], partner: [] };
      out.set(key, m);
    }
    return m;
  };
  for (const [key, counts] of bas) for (const [code, n] of counts) entry(key).bas.push({ code, n });
  for (const [key, counts] of partner)
    for (const [id, n] of counts) entry(key).partner.push({ id, n });
  for (const m of out.values()) {
    m.bas.sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
    m.partner.sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  }
  return out;
}

/** A row the owner categorised by hand or justified — an example the model reads (F98 PR 2, FR-201; D82). */
export type ConfirmedExample = { text: string; amount: string; currency: string; basCode: string };
export type ConfirmedExampleRow = ConfirmedExample & { id: string };

/**
 * The owner's own categorised rows — by hand, or justified by a proof with a category (`learnedRows`, D82) —
 * newest first: the pool examples are picked from.
 */
export async function confirmedExampleRows(
  tx: TransactionClient,
  take = 500,
): Promise<ConfirmedExampleRow[]> {
  // a proof without a category (a plain document) teaches none: read a margin, keep `take`
  const rows = await learnedRows(tx, {}, { take: take * 2 });
  return rows
    .filter((r) => r.learned.basCode !== null)
    .slice(0, take)
    .map((r) => ({
      id: r.id,
      text: bankText(r),
      amount: r.amount.toFixed(2),
      currency: r.currency,
      basCode: r.learned.basCode as string,
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
 * The eval's replay (F98 PR 2, FR-010): the rows the owner categorised by hand or justified (D82) since a day,
 * each as stage 1 would have seen it before he did — category off, his own row taken out of the history (leave one
 * out). The partner stays as he set it. The truth (his code) comes back beside each input. Read only.
 */
export async function proposalReplayInputs(
  tx: TransactionClient,
  opts: { since: string; limit?: number },
): Promise<{ input: ProposalInput; truth: string }[]> {
  // by hand or justified (D82): the truth is the category the owner typed or his proof gives
  const rows = (
    await learnedRows(
      tx,
      { bookingDate: { gte: new Date(`${opts.since}T00:00:00Z`) } },
      { take: opts.limit ?? 1_000 },
    )
  ).filter((r) => r.learned.basCode !== null);
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
    const truth = r.learned.basCode as string;
    const partnerId = r.learned.partnerId ?? r.partnerId;
    return {
      truth,
      input: {
        row: {
          id: r.id,
          bookingDate: r.bookingDate.toISOString().slice(0, 10),
          amount: r.amount.toFixed(2),
          currency: r.currency,
          counterpartyKey: r.counterpartyKey,
          text: bankText(r),
          basCode: null,
          partnerId,
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
        partnerDefault: partnerId ? (defaults.get(partnerId) ?? null) : null,
        memory: {
          bas: minus(own.bas, (x) => x.code === truth),
          partner: minus(own.partner, (x) => x.id === r.learned.partnerId),
        },
      },
    };
  });
}
