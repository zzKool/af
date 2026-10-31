// Proposals (F98, specs/ai): what stage 1 (and, with PR 2, the local model) proposes for a bank row's category
// or partner. This module owns the table; it writes proposals and the owner's decisions — never a row's facts,
// which only banking's `categorise` writes, on the owner's key (accept).
//
//   run      → stage 1 per open row → a new proposal unless the same one is still current, or one was
//              rejected on the same facts (facts hash)
//   current  → the newest proposal per (row, kind), undecided, while the row still lacks that fact — derived
//   accept   → banking.categorise(by: manual) + the decision, one transaction; the rule offer when no rule fits
//   reject   → the decision; the next runs skip that kind while the row's facts are unchanged
import { Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type AppError, RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import * as banking from "@/modules/banking";
import type { ProposalDto } from "../types";
import { factsHash } from "./facts-hash";
import {
  type ParsedPayload,
  type ProposalKindName,
  type ProposalSourceName,
  parsePayload,
} from "./payload";
import { familyOf, isPrefilled, isShown } from "./policy";
import { type Draft, stage1 } from "./stage1";

export type { ProposalDto };

const forbidden = (): AppError => ({
  code: "FORBIDDEN",
  message: "Only the owner decides a proposal",
  retryable: false,
});
const notFound = (id: string): AppError => ({
  code: "NOT_FOUND",
  message: `Proposal not found: ${id}`,
  retryable: false,
});
const stale = (): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message: "This proposal is no longer current — the row changed or a newer one exists",
  retryable: false,
});

type Row = Prisma.ProposalGetPayload<object>;

function toDto(row: Row): ProposalDto | null {
  const parsed = parsePayload(row.kind, row.payload);
  if (!parsed) return null;
  const confidence = Number(row.confidence);
  return {
    id: row.id,
    runId: row.runId,
    targetId: row.targetId,
    source: row.source,
    confidence,
    family: familyOf(confidence),
    prefilled: isPrefilled(confidence),
    reason: row.reason,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    ...parsed,
  };
}

/** The newest proposal per (row, kind) among these rows, whatever its decision. */
async function newestPerKind(
  tx: TransactionClient,
  targetIds: readonly string[],
): Promise<Map<string, Row>> {
  const rows = await tx.proposal.findMany({
    where: { targetType: "bank_transaction", targetId: { in: [...targetIds] } },
    orderBy: { createdAt: "desc" },
  });
  const out = new Map<string, Row>();
  for (const r of rows) {
    const k = `${r.targetId}#${r.kind}`;
    if (!out.has(k)) out.set(k, r);
  }
  return out;
}

const samePayload = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- the run ---

export type RunResult = {
  runId: string;
  rows: number;
  proposed: number;
  unchanged: number;
  skipped: number;
};

/**
 * Stage 1 over these rows (only those still open: not categorised by hand, missing a category or a partner).
 * Writes one proposal per new answer under `runId`; leaves a still-current identical one alone; skips a kind the
 * owner rejected on the same facts.
 */
export async function runProposals(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: { runId: string; transactionIds: readonly string[] },
): Promise<RunResult> {
  const inputs = await banking.proposalInputs(tx, input.transactionIds);
  const result: RunResult = {
    runId: input.runId,
    rows: inputs.length,
    proposed: 0,
    unchanged: 0,
    skipped: 0,
  };
  if (inputs.length === 0) return result;

  const ids = inputs.map((i) => i.row.id);
  const newest = await newestPerKind(tx, ids);
  const rejected = await tx.proposal.findMany({
    where: { targetType: "bank_transaction", targetId: { in: ids }, decision: "rejected" },
    select: { targetId: true, kind: true, factsHash: true },
  });
  const rejectedOn = new Set(rejected.map((r) => `${r.targetId}#${r.kind}#${r.factsHash}`));

  const writes: Prisma.ProposalCreateManyInput[] = [];
  for (const i of inputs) {
    const hash = factsHash(i.row);
    for (const d of stage1(i) as Draft[]) {
      if (rejectedOn.has(`${i.row.id}#${d.kind}#${hash}`)) {
        result.skipped++;
        continue;
      }
      const current = newest.get(`${i.row.id}#${d.kind}`);
      if (
        current &&
        current.decision === null &&
        current.factsHash === hash &&
        current.source === d.source &&
        Number(current.confidence) === d.confidence &&
        samePayload(current.payload, d.payload)
      ) {
        result.unchanged++;
        continue;
      }
      writes.push({
        tenantId: caller.tenantId,
        runId: input.runId,
        targetType: "bank_transaction",
        targetId: i.row.id,
        bankTransactionId: i.row.id,
        kind: d.kind,
        payload: d.payload as Prisma.InputJsonValue,
        source: d.source,
        confidence: new Prisma.Decimal(d.confidence.toFixed(2)),
        reason: d.reason.slice(0, 200),
        factsHash: hash,
        createdBy: caller.userId,
      });
    }
  }
  if (writes.length) await tx.proposal.createMany({ data: writes });
  result.proposed = writes.length;
  return result;
}

// --- reads ---

/**
 * The proposals to show, per row: the newest per kind, undecided, shown (not LOW), and only while the row still
 * lacks that fact (a row categorised since has nothing to propose). Unknown ids are absent.
 */
export async function currentProposals(
  tx: TransactionClient,
  transactionIds: readonly string[],
): Promise<Map<string, ProposalDto[]>> {
  const ids = [...new Set(transactionIds)];
  if (ids.length === 0) return new Map();
  const facts = await banking.transactionFacts(tx, ids);
  return currentForRows(tx, [...facts.values()]);
}

/** The row facts the current proposals depend on (the list passes the rows it already read). */
export type RowFactsForProposals = {
  id: string;
  basCode: string | null;
  partnerId: string | null;
  categorisedBy: string | null;
};

/** `currentProposals` over rows whose facts are at hand — one query, only for the rows that can still have one. */
export async function currentForRows(
  tx: TransactionClient,
  rows: readonly RowFactsForProposals[],
): Promise<Map<string, ProposalDto[]>> {
  const out = new Map<string, ProposalDto[]>();
  const open = rows.filter(
    (r) => r.categorisedBy !== "manual" && (r.basCode === null || r.partnerId === null),
  );
  if (open.length === 0) return out;
  const facts = new Map(open.map((r) => [r.id, r]));
  const newest = await newestPerKind(tx, [...facts.keys()]);
  for (const row of newest.values()) {
    if (row.decision !== null) continue;
    const f = facts.get(row.targetId);
    if (!f) continue;
    if (row.kind === "bas" && f.basCode !== null) continue;
    if (row.kind === "partner" && f.partnerId !== null) continue;
    const dto = toDto(row);
    if (!dto || !isShown(dto.confidence)) continue;
    const list = out.get(row.targetId) ?? [];
    list.push(dto);
    out.set(row.targetId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.kind.localeCompare(b.kind));
  return out;
}

export type ProposalStats = {
  days: number;
  bySource: { source: ProposalSourceName; made: number; accepted: number; rejected: number }[];
  lastRunAt: string | null;
};

/** Settings → AI: per source, what was proposed and what the owner did with it in the last `days` days. */
export async function proposalStats(
  tx: TransactionClient,
  days: number,
  now: Date = new Date(),
): Promise<ProposalStats> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const groups = await tx.proposal.groupBy({
    by: ["source", "decision"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const last = await tx.proposal.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const by = new Map<ProposalSourceName, { made: number; accepted: number; rejected: number }>();
  for (const g of groups) {
    const s = by.get(g.source) ?? { made: 0, accepted: 0, rejected: 0 };
    s.made += g._count._all;
    if (g.decision === "accepted") s.accepted += g._count._all;
    if (g.decision === "rejected") s.rejected += g._count._all;
    by.set(g.source, s);
  }
  return {
    days,
    bySource: [...by.entries()].map(([source, s]) => ({ source, ...s })),
    lastRunAt: last?.createdAt.toISOString() ?? null,
  };
}

// --- the owner's key ---

export type AcceptResult = {
  transaction: banking.BankTransactionDto;
  accepted: string[];
  proposeRule: boolean;
};

/**
 * Accept the given proposals of one row — or, without ids, every current one — in one categorise call
 * (`by: manual`: the owner's key is the categorisation). `overrideBasCode` replaces the proposed category
 * (an alternative chip). Refused when a proposal is not current any more.
 */
export async function acceptProposals(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: {
    transactionId: string;
    proposalIds?: readonly string[];
    overrideBasCode?: string | null;
  },
): Promise<ServiceResult<AcceptResult>> {
  if (!can(caller, "update", "bank_transaction")) return { error: forbidden() };
  const current =
    (await currentProposals(tx, [input.transactionId])).get(input.transactionId) ?? [];
  const wanted = input.proposalIds?.length
    ? input.proposalIds.map((id) => current.find((p) => p.id === id))
    : current;
  if (wanted.length === 0) return { error: stale() };
  if (wanted.some((p) => !p)) return { error: stale() };
  const picked = wanted as ProposalDto[];

  const facts: { basCode?: string; partnerId?: string } = {};
  for (const p of picked) {
    if (p.kind === "bas") facts.basCode = input.overrideBasCode ?? p.payload.basCode;
    if (p.kind === "partner") {
      if (!("partnerId" in p.payload)) return { error: stale() }; // a new partner arrives with PR 2
      facts.partnerId = p.payload.partnerId;
    }
  }

  // the rule offer: when no active rule would have categorised this row (read before the row turns manual)
  const [inputRow] = await banking.proposalInputs(tx, [input.transactionId]);
  const proposeRule = !!inputRow && inputRow.rule === null;

  const r = await banking.categorise(tx, caller, audit, input.transactionId, facts);
  if (r.error) return { error: r.error };

  const decidedAt = new Date();
  for (const p of picked) {
    const updated = await tx.proposal.updateMany({
      where: { id: p.id, decision: null },
      data: { decision: "accepted", decidedAt, decidedBy: caller.userId },
    });
    if (updated.count !== 1) throw new RollbackError(stale());
    await audit.log({
      action: "update",
      entityType: "proposal",
      entityId: p.id,
      oldData: toAuditData({ decision: null }),
      newData: toAuditData({
        decision: "accepted",
        kind: p.kind,
        source: p.source,
        transactionId: input.transactionId,
        ...(p.kind === "bas" && input.overrideBasCode
          ? { overrideBasCode: input.overrideBasCode }
          : {}),
      }),
    });
  }
  return { data: { transaction: r.data, accepted: picked.map((p) => p.id), proposeRule } };
}

/** Reject one proposal: recorded with a time; the next runs skip that kind while the row's facts are unchanged. */
export async function rejectProposal(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { proposalId: string },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(caller, "update", "bank_transaction")) return { error: forbidden() };
  const row = await tx.proposal.findUnique({ where: { id: input.proposalId } });
  if (!row) return { error: notFound(input.proposalId) };
  const current = (await currentProposals(tx, [row.targetId])).get(row.targetId) ?? [];
  if (!current.some((p) => p.id === row.id)) return { error: stale() };
  await tx.proposal.update({
    where: { id: row.id },
    data: { decision: "rejected", decidedAt: new Date(), decidedBy: caller.userId },
  });
  await audit.log({
    action: "update",
    entityType: "proposal",
    entityId: row.id,
    oldData: toAuditData({ decision: null }),
    newData: toAuditData({
      decision: "rejected",
      kind: row.kind,
      source: row.source,
      transactionId: row.targetId,
    }),
  });
  return { data: { id: row.id } };
}

/**
 * Before banking deletes rows (an import's delete): their proposals go first — the composite FK is RESTRICT and
 * D63 forbids a cascade across modules. Returns how many were dropped.
 */
export async function dropProposalsFor(
  tx: TransactionClient,
  transactionIds: readonly string[],
): Promise<number> {
  if (transactionIds.length === 0) return 0;
  const r = await tx.proposal.deleteMany({
    where: { targetType: "bank_transaction", targetId: { in: [...transactionIds] } },
  });
  return r.count;
}

export type { ProposalKindName };
