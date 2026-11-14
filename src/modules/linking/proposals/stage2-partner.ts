// Stage 2 for the partner (F98 T013b, specs/ai FR-005, US2; docs/local-ai.md §5): the local model names the
// counterparty behind a bank text — one of the tenant's partners, or a company not among them yet (created on the
// owner's accept, never here). Asked only for the rows stage 1 left without a partner, and **once per counterparty
// key**: every row of the key gets the one answer, so two rows of the same counterparty cannot be named differently.
//
//   prepare (tx)   the open rows without a partner and without a current stage-1 partner proposal, minus those the
//                  model already answered on the same facts — grouped by counterparty key; the partner list
//   ask (no tx)    one key at a time; a timeout is retried once; an unreachable model stops the run
//   write (tx)     the answers, for the rows still without a partner
//
// *Nobody* is an answer too: it is kept (`NO_PARTNER_PAYLOAD`, confidence 0, never shown) so the row is not asked
// again every night.
import { Prisma } from "@/generated/prisma/client";
import type { AiService } from "@/kernel/ai/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as partners from "@/modules/partners";
import { factsHash } from "./facts-hash";
import { NO_PARTNER_PAYLOAD, type PartnerPayload } from "./payload";
import { MODEL_MAX_CONFIDENCE } from "./policy";
import {
  PARTNER_PROPOSAL_TASK,
  PARTNER_PROPOSAL_VERSION,
  type PartnerProposalAnswer,
  type PromptPartner,
  partnerPromptFactsHash,
  partnerProposalSchema,
  partnerProposalSystem,
  partnerProposalUser,
  toPromptPartners,
} from "./prompts/partner-proposal";
import { modelFactsHash } from "./stage2";

/** Counterparties asked per run, newest first — the nightly run takes the rest. */
export const PARTNER_STAGE2_MAX_KEYS = 60;

/** One question: a counterparty key, its rows (each with its facts hash) and the newest row's message. */
export type PartnerRequest = {
  key: string;
  targets: { targetId: string; factsHash: string }[];
  user: string;
};
export type PartnerPrepared = { partners: PromptPartner[]; requests: PartnerRequest[] };
export type PartnerStage2Draft = {
  targetId: string;
  factsHash: string;
  /** null: the model named nobody */
  payload: PartnerPayload | null;
  confidence: number;
  reason: string;
  model: string;
};
export type PartnerStage2Outcome = {
  drafts: PartnerStage2Draft[];
  asked: number;
  failed: number;
  stopped: boolean;
};

/**
 * A partner proposal's row facts: the counterparty and the amount, and that the row has no partner — not its
 * category (accepting the category must not ask for the partner again, nor bring a rejected one back).
 */
export function partnerRowFactsHash(row: { counterpartyKey: string; amount: string }): string {
  return factsHash({ ...row, basCode: null, partnerId: null });
}

const fold = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** The model's answer as a payload: a listed partner, a company already there under that name, a new one, nobody. */
export function partnerAnswerPayload(
  answer: PartnerProposalAnswer,
  list: readonly PromptPartner[],
): PartnerPayload | null {
  if (answer.partner) {
    const hit = list.find((p) => p.ref === answer.partner);
    if (hit) return { partnerId: hit.id };
  }
  if (!answer.newPartner) return null;
  const name = answer.newPartner.name.trim();
  const existing = list.find((p) => fold(p.name) === fold(name));
  if (existing) return { partnerId: existing.id };
  return {
    newPartner: {
      name,
      type: answer.newPartner.type,
      ...(answer.newPartner.country ? { country: answer.newPartner.country.toUpperCase() } : {}),
    },
  };
}

/** The counterparties to ask the model about, and the partner list — null when there is nothing to ask. */
export async function preparePartnerStage2(
  tx: TransactionClient,
  transactionIds: readonly string[],
  maxKeys = PARTNER_STAGE2_MAX_KEYS,
): Promise<PartnerPrepared | null> {
  const inputs = (await banking.proposalInputs(tx, transactionIds)).filter(
    (i) => i.row.partnerId === null && i.row.counterpartyKey.trim() !== "",
  );
  if (inputs.length === 0) return null;

  const ids = inputs.map((i) => i.row.id);
  const existing = await tx.proposal.findMany({
    where: { targetType: "bank_transaction", targetId: { in: ids }, kind: "partner" },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, source: true, decision: true, factsHash: true },
  });
  const newest = new Map<string, (typeof existing)[number]>();
  const modelOn = new Set<string>();
  for (const p of existing) {
    if (!newest.has(p.targetId)) newest.set(p.targetId, p);
    if (p.source === "model") modelOn.add(`${p.targetId}#${p.factsHash}`);
  }

  const promptHash = partnerPromptFactsHash();
  const byKey = new Map<string, PartnerRequest>();
  for (const i of inputs) {
    const n = newest.get(i.row.id);
    // stage 1 has a current answer: the model is not asked
    if (n && n.decision === null && n.source !== "model") continue;
    const hash = modelFactsHash(partnerRowFactsHash(i.row), promptHash);
    // the model answered on these facts already (current, rejected, or *nobody*): not asked again
    if (modelOn.has(`${i.row.id}#${hash}`)) continue;
    const request = byKey.get(i.row.counterpartyKey);
    if (request) {
      request.targets.push({ targetId: i.row.id, factsHash: hash });
      continue;
    }
    if (byKey.size >= maxKeys) continue;
    byKey.set(i.row.counterpartyKey, {
      key: i.row.counterpartyKey,
      targets: [{ targetId: i.row.id, factsHash: hash }],
      // the inputs come newest first: the key's newest row speaks for it
      user: partnerProposalUser({
        bookingDate: i.row.bookingDate,
        amount: i.row.amount,
        currency: i.row.currency,
        counterparty: i.row.counterpartyKey,
        text: i.row.text,
      }),
    });
  }
  if (byKey.size === 0) return null;

  const list = (await partners.getPartners(tx, {})).data ?? [];
  return {
    partners: toPromptPartners(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        types: p.types,
        country: p.address?.country ?? null,
      })),
    ),
    requests: [...byKey.values()],
  };
}

/** Asks the model, one counterparty at a time — outside any transaction. */
export async function askPartnerStage2(
  ai: AiService,
  prepared: PartnerPrepared,
): Promise<PartnerStage2Outcome> {
  const out: PartnerStage2Outcome = { drafts: [], asked: 0, failed: 0, stopped: false };
  if (ai.kind === "off") return { ...out, stopped: true };
  const system = partnerProposalSystem(prepared.partners);
  const schema = partnerProposalSchema(prepared.partners.map((p) => p.ref));
  for (const r of prepared.requests) {
    const call = {
      task: PARTNER_PROPOSAL_TASK,
      promptVersion: PARTNER_PROPOSAL_VERSION,
      messages: [
        { role: "system" as const, content: system },
        { role: "user" as const, content: r.user },
      ],
      schema,
    };
    out.asked++;
    let res = await ai.complete(call);
    if (!res.ok && res.error === "timeout") res = await ai.complete(call);
    if (!res.ok) {
      out.failed++;
      if (res.error === "unavailable") {
        out.stopped = true;
        break;
      }
      continue;
    }
    const payload = partnerAnswerPayload(res.data, prepared.partners);
    const confidence = payload
      ? Math.round(Math.min(res.data.confidence, MODEL_MAX_CONFIDENCE) * 100) / 100
      : 0;
    const reason = res.data.reason.trim() || "Proposed by the model";
    for (const t of r.targets)
      out.drafts.push({ ...t, payload, confidence, reason, model: res.model });
  }
  return out;
}

/** Writes the model's answers under the run, for the rows still without a partner. */
export async function writePartnerStage2(
  tx: TransactionClient,
  caller: CallerIdentity,
  runId: string,
  drafts: readonly PartnerStage2Draft[],
): Promise<number> {
  if (drafts.length === 0) return 0;
  const open = new Set(
    (
      await banking.proposalInputs(
        tx,
        drafts.map((d) => d.targetId),
      )
    )
      .filter((i) => i.row.partnerId === null)
      .map((i) => i.row.id),
  );
  const data: Prisma.ProposalCreateManyInput[] = drafts
    .filter((d) => open.has(d.targetId))
    .map((d) => ({
      tenantId: caller.tenantId,
      runId,
      targetType: "bank_transaction",
      targetId: d.targetId,
      bankTransactionId: d.targetId,
      kind: "partner",
      payload: (d.payload ?? NO_PARTNER_PAYLOAD) as Prisma.InputJsonValue,
      source: "model",
      confidence: new Prisma.Decimal(d.confidence.toFixed(2)),
      reason: d.reason.slice(0, 200),
      model: d.model.slice(0, 100),
      promptVersion: PARTNER_PROPOSAL_VERSION,
      factsHash: d.factsHash,
      createdBy: caller.userId,
    }));
  if (data.length) await tx.proposal.createMany({ data, skipDuplicates: true });
  // the proposals to show: *nobody* is kept, not counted
  return drafts.filter((d) => open.has(d.targetId) && d.payload !== null).length;
}
