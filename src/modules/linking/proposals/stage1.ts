// Stage 1 of the proposals (F98, specs/ai FR-004): what the rules, the partner's default and the owner's history
// already know about a row — deterministic, free, no model. Pure: the inputs are fetched by banking
// (`proposalInputs`), the drafts are written by `proposals.ts`.
import type { CategoryMemory, ProposalInput } from "@/modules/banking";
import type { BasPayload, PartnerPayload, ProposalSourceName } from "./payload";
import {
  DISAGREEMENT_CAP,
  MEMORY_MIN_ROWS,
  MEMORY_MIN_SHARE,
  memoryConfidence,
  PARTNER_DEFAULT_CONFIDENCE,
  RULE_CONFIDENCE,
} from "./policy";

export type BasDraft = {
  kind: "bas";
  payload: BasPayload;
  source: ProposalSourceName;
  confidence: number;
  reason: string;
};
export type PartnerDraft = {
  kind: "partner";
  payload: PartnerPayload;
  source: ProposalSourceName;
  confidence: number;
  reason: string;
};
export type Draft = BasDraft | PartnerDraft;

type Candidate<V> = { value: V; source: ProposalSourceName; confidence: number; reason: string };

/** The history's answer for one fact: the most frequent value when there are enough rows and they agree. */
export function fromMemory<V>(
  counts: readonly { value: V; n: number }[],
): { value: V; n: number; total: number } | null {
  const total = counts.reduce((s, c) => s + c.n, 0);
  const top = counts[0];
  if (!top || total < MEMORY_MIN_ROWS) return null;
  if (top.n / total < MEMORY_MIN_SHARE) return null;
  return { value: top.value, n: top.n, total };
}

/**
 * The sources in priority order (rule → partner default → memory). The first answers; when another source
 * names a different value, the chosen one is capped under HIGH and the others become its alternatives.
 */
function resolve<V>(candidates: readonly Candidate<V>[]): {
  chosen: Candidate<V>;
  others: Candidate<V>[];
} | null {
  const [first, ...rest] = candidates;
  if (!first) return null;
  const others = rest.filter((c) => c.value !== first.value);
  if (others.length === 0) return { chosen: first, others: [] };
  return {
    chosen: { ...first, confidence: Math.min(first.confidence, DISAGREEMENT_CAP) },
    others,
  };
}

function memoryReason(n: number, total: number): string {
  return n === total
    ? `Set by hand on ${n} rows of this counterparty`
    : `Set by hand on ${n} of ${total} rows of this counterparty`;
}

export function stage1(input: ProposalInput): Draft[] {
  const { row, rule, partnerDefault, memory } = input;
  const drafts: Draft[] = [];

  if (row.basCode === null) {
    const c: Candidate<string>[] = [];
    if (rule?.basCode)
      c.push({
        value: rule.basCode,
        source: "rule",
        confidence: RULE_CONFIDENCE,
        reason: `Rule “${rule.ruleName}”`,
      });
    if (partnerDefault)
      c.push({
        value: partnerDefault,
        source: "partner_default",
        confidence: PARTNER_DEFAULT_CONFIDENCE,
        reason: "The partner's default category",
      });
    const m = fromMemory(basCounts(memory));
    if (m)
      c.push({
        value: m.value,
        source: "memory",
        confidence: memoryConfidence(m.n),
        reason: memoryReason(m.n, m.total),
      });
    const r = resolve(c);
    if (r)
      drafts.push({
        kind: "bas",
        payload: {
          basCode: r.chosen.value,
          alternatives: r.others.map((o) => ({ basCode: o.value, why: o.reason })),
        },
        source: r.chosen.source,
        confidence: r.chosen.confidence,
        reason: r.chosen.reason,
      });
  }

  if (row.partnerId === null) {
    const c: Candidate<string>[] = [];
    if (rule?.partnerId)
      c.push({
        value: rule.partnerId,
        source: "rule",
        confidence: RULE_CONFIDENCE,
        reason: `Rule “${rule.ruleName}”`,
      });
    const m = fromMemory(memory.partner.map((p) => ({ value: p.id, n: p.n })));
    if (m)
      c.push({
        value: m.value,
        source: "memory",
        confidence: memoryConfidence(m.n),
        reason: memoryReason(m.n, m.total),
      });
    const r = resolve(c);
    if (r)
      drafts.push({
        kind: "partner",
        payload: { partnerId: r.chosen.value },
        source: r.chosen.source,
        confidence: r.chosen.confidence,
        reason: r.chosen.reason,
      });
  }

  return drafts;
}

function basCounts(memory: CategoryMemory): { value: string; n: number }[] {
  return memory.bas.map((b) => ({ value: b.code, n: b.n }));
}
