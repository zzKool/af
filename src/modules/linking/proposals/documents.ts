// Proposals on documents (F126, specs/ai/spec-suggest-from-first-entry.md FR-203 / FR-204): the model's BAS account
// for a receipt or a supplier invoice still in the inbox — so the *New expense* / *New supplier invoice* dialog
// opens with it, from the vendor's first document. Same prompt as a bank row's (the static part is shared), the
// document's vendor, lines and total as the question.
//
//   prepare (tx)   inbox documents (nothing made from them yet) whose vendor has no default account, not yet
//                  answered on these facts
//   ask (no tx)    stage2's `askStage2`
//   write (tx)     the answers, for the documents still in the inbox
//   decide         the dialog's save: the code kept → accepted, another code → rejected (one transaction with it)
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as partners from "@/modules/partners";
import type { BasProposalHint } from "@/modules/settings";
import * as settings from "@/modules/settings";
import { createdFromTargets } from "../queries";
import type { ProposalDto } from "../types";
import { parsePayload } from "./payload";
import { familyOf, isPrefilled, isShown } from "./policy";
import {
  BAS_PROPOSAL_VERSION,
  basProposalUserForDocument,
  promptFactsHash,
  toPromptAccounts,
} from "./prompts/bas-proposal";
import type { Stage2Draft, Stage2Prepared, Stage2Request } from "./stage2";

/** Documents asked per run — the nightly takes the rest. */
export const DOCUMENT_MAX_PER_RUN = 30;

const RECEIPT_PREFIXES = new Set(["expense", "receipt"]);

/** The documents to ask about — null when none. `all`: every inbox document (nightly, *Run now*). */
export async function prepareDocumentProposals(
  tx: TransactionClient,
  caller: CallerIdentity,
  scope: { documentIds: readonly string[] } | { all: true },
  max = DOCUMENT_MAX_PER_RUN,
): Promise<Stage2Prepared | null> {
  const facts = await documents.inboxFinancialFacts(
    tx,
    caller,
    "all" in scope ? { from: "0000-01-01", to: "9999-12-31" } : { ids: scope.documentIds },
  );
  if (facts.length === 0) return null;
  const options = await settings.basPickerOptions(tx);
  if (options.length === 0) return null;
  const accounts = toPromptAccounts(options);
  const promptHash = promptFactsHash(accounts);

  const asked = new Set(
    (
      await tx.proposal.findMany({
        where: {
          targetType: "document",
          documentId: { in: facts.map((f) => f.id) },
          kind: "bas",
          source: "model",
        },
        select: { targetId: true, factsHash: true },
      })
    ).map((p) => `${p.targetId}#${p.factsHash}`),
  );

  const requests: Stage2Request[] = [];
  for (const f of facts) {
    if (!f.vendorName && f.lines.length === 0) continue; // nothing to read
    // the vendor's own default account answers first (the dialog pre-fills it): the model is not asked
    const [best] = await partners.matchPartners(
      tx,
      { name: f.vendorName, vatNumber: f.vendorVatNumber, type: "vendor" },
      1,
    );
    if (best && best.percent >= partners.BEST_MATCH_PERCENT) {
      const p = await partners.getPartner(tx, best.partnerId);
      if (p.data?.defaultBasCategoryCode) continue;
    }
    const doc = {
      kind: RECEIPT_PREFIXES.has(f.prefixType) ? ("receipt" as const) : ("invoice" as const),
      date: f.date,
      vendor: f.vendorName,
      lines: f.lines,
      total: f.total,
      currency: f.currency,
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(doc))
      .update("␟")
      .update(promptHash)
      .digest("hex");
    if (asked.has(`${f.id}#${hash}`)) continue;
    requests.push({ targetId: f.id, factsHash: hash, user: basProposalUserForDocument(doc) });
    if (requests.length >= max) break;
  }
  if (requests.length === 0) return null;
  return {
    accounts,
    examples: await banking.confirmedExamples(tx),
    activeCodes: accounts.map((a) => a.code),
    requests,
  };
}

/** Writes the model's answers for the documents still in the inbox (nothing made from them since). */
export async function writeDocumentProposals(
  tx: TransactionClient,
  caller: CallerIdentity,
  runId: string,
  drafts: readonly Stage2Draft[],
): Promise<number> {
  if (drafts.length === 0) return 0;
  const became = await createdFromTargets(
    tx,
    drafts.map((d) => d.targetId),
  );
  const data: Prisma.ProposalCreateManyInput[] = drafts
    .filter((d) => !became.has(d.targetId))
    .map((d) => ({
      tenantId: caller.tenantId,
      runId,
      targetType: "document",
      targetId: d.targetId,
      documentId: d.targetId,
      kind: "bas",
      payload: d.payload as Prisma.InputJsonValue,
      source: "model",
      confidence: new Prisma.Decimal(d.confidence.toFixed(2)),
      reason: d.reason.slice(0, 200),
      model: d.model.slice(0, 100),
      promptVersion: BAS_PROPOSAL_VERSION,
      factsHash: d.factsHash,
      createdBy: caller.userId,
    }));
  if (data.length) await tx.proposal.createMany({ data, skipDuplicates: true });
  return data.length;
}

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

/** Per document, its current BAS proposal: the newest, undecided, shown (not LOW). Unknown ids are absent. */
export async function currentDocumentProposals(
  tx: TransactionClient,
  documentIds: readonly string[],
): Promise<Map<string, ProposalDto>> {
  const out = new Map<string, ProposalDto>();
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) return out;
  const rows = await tx.proposal.findMany({
    where: { targetType: "document", documentId: { in: ids }, kind: "bas" },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.targetId)) continue;
    seen.add(r.targetId);
    if (r.decision !== null) continue;
    const dto = toDto(r);
    if (dto && isShown(dto.confidence)) out.set(r.targetId, dto);
  }
  return out;
}

/**
 * The dialog saved what the document became, with this account: its current proposal is accepted when the code
 * is the proposed one, rejected otherwise — in the caller's transaction, one audit row. Nothing when there is none.
 */
export async function decideDocumentProposal(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  documentId: string,
  chosenCode: string | null,
): Promise<"accepted" | "rejected" | null> {
  const current = (await currentDocumentProposals(tx, [documentId])).get(documentId);
  if (!current || current.kind !== "bas") return null;
  const decision = chosenCode === current.payload.basCode ? "accepted" : "rejected";
  await tx.proposal.update({
    where: { id: current.id },
    data: { decision, decidedAt: new Date(), decidedBy: caller.userId },
  });
  await audit.log({
    action: "update",
    entityType: "proposal",
    entityId: current.id,
    oldData: toAuditData({ decision: null }),
    newData: toAuditData({ decision, kind: "bas", source: current.source, documentId }),
  });
  return decision;
}

/** Before documents deletes a document: its proposals go first (RESTRICT, no cascade — D63). */
export async function dropProposalsForDocuments(
  tx: TransactionClient,
  documentIds: readonly string[],
): Promise<number> {
  if (documentIds.length === 0) return 0;
  const r = await tx.proposal.deleteMany({
    where: { targetType: "document", documentId: { in: [...documentIds] } },
  });
  return r.count;
}

/** The dialogs' form of the current proposals (F126, FR-204): per document, the code, its reason, HIGH → prefill. */
export async function documentBasHints(
  tx: TransactionClient,
  documentIds: readonly string[],
): Promise<Record<string, BasProposalHint>> {
  const out: Record<string, BasProposalHint> = {};
  for (const [id, p] of await currentDocumentProposals(tx, documentIds))
    if (p.kind === "bas")
      out[id] = { code: p.payload.basCode, reason: p.reason, prefill: p.prefilled };
  return out;
}
