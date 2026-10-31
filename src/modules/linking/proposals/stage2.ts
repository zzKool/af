// Stage 2 of the proposals (F98 PR 2, specs/ai FR-005, spec-suggest-from-first-entry FR-201): the local model,
// asked only for the rows stage 1 left without a category — a counterparty never seen before is proposed from its
// first row. Three steps, because nothing calls out inside a transaction (constitution):
//
//   prepare (tx)   the open rows without a current stage-1 category proposal, minus those the model already
//                  answered on the same facts; the prompt's static part (the active accounts, the examples)
//   ask (no tx)    one row at a time; a timeout is retried once, then the row waits for the next run; an
//                  unreachable model stops the run (the next run tries again); a wrong shape skips the row
//   write (tx)     the answers, for the rows still open
//
// The model writes proposals only — a category is set on the owner's key (accept), never here.
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { AiService } from "@/kernel/ai/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as settings from "@/modules/settings";
import { factsHash } from "./facts-hash";
import type { BasPayload } from "./payload";
import { MODEL_MAX_CONFIDENCE } from "./policy";
import {
  BAS_PROPOSAL_TASK,
  BAS_PROPOSAL_VERSION,
  basProposalSchema,
  basProposalSystem,
  basProposalUser,
  type PromptAccount,
  type PromptExample,
  type PromptRow,
  promptFactsHash,
} from "./prompts/bas-proposal";

/** Rows asked per run, newest first — a CPU box answers one in seconds; the nightly run takes the rest. */
export const STAGE2_MAX_ROWS = 60;

export type Stage2Request = { targetId: string; factsHash: string; row: PromptRow };
export type Stage2Prepared = {
  accounts: PromptAccount[];
  examples: PromptExample[];
  activeCodes: string[];
  requests: Stage2Request[];
};
export type Stage2Draft = {
  targetId: string;
  factsHash: string;
  payload: BasPayload;
  confidence: number;
  reason: string;
  model: string;
};
export type Stage2Outcome = {
  drafts: Stage2Draft[];
  asked: number;
  failed: number;
  /** the model was unreachable: the remaining rows wait for the next run */
  stopped: boolean;
};

/** A model proposal's facts: the row's own and the prompt's (version, accounts, notes). */
export function modelFactsHash(rowHash: string, promptHash: string): string {
  return createHash("sha256").update(`${rowHash}␟${promptHash}`).digest("hex");
}

/** The rows to ask the model about, and the prompt's static part — null when there is nothing to ask. */
export async function prepareStage2(
  tx: TransactionClient,
  transactionIds: readonly string[],
  maxRows = STAGE2_MAX_ROWS,
): Promise<Stage2Prepared | null> {
  const inputs = (await banking.proposalInputs(tx, transactionIds)).filter(
    (i) => i.row.basCode === null,
  );
  if (inputs.length === 0) return null;
  const options = await settings.basPickerOptions(tx);
  if (options.length === 0) return null;
  const accounts: PromptAccount[] = options.map((o) => ({
    code: o.code,
    name: o.name ?? o.label,
    nameSv: o.nameSv ?? null,
  }));
  const activeCodes = accounts.map((a) => a.code);
  const promptHash = promptFactsHash(accounts);

  const ids = inputs.map((i) => i.row.id);
  const existing = await tx.proposal.findMany({
    where: { targetType: "bank_transaction", targetId: { in: ids }, kind: "bas" },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, source: true, decision: true, factsHash: true },
  });
  const newest = new Map<string, (typeof existing)[number]>();
  const modelOn = new Set<string>();
  for (const p of existing) {
    if (!newest.has(p.targetId)) newest.set(p.targetId, p);
    if (p.source === "model") modelOn.add(`${p.targetId}#${p.factsHash}`);
  }

  const requests: Stage2Request[] = [];
  for (const i of inputs) {
    const n = newest.get(i.row.id);
    // stage 1 has a current answer: the model is not asked
    if (n && n.decision === null && n.source !== "model") continue;
    const hash = modelFactsHash(factsHash(i.row), promptHash);
    // the model answered on these facts already (current, or rejected): not asked again
    if (modelOn.has(`${i.row.id}#${hash}`)) continue;
    requests.push({
      targetId: i.row.id,
      factsHash: hash,
      row: {
        bookingDate: i.row.bookingDate,
        amount: i.row.amount,
        currency: i.row.currency,
        text: i.row.text,
      },
    });
    if (requests.length >= maxRows) break;
  }
  if (requests.length === 0) return null;
  const examples = await banking.confirmedExamples(tx);
  return { accounts, examples, activeCodes, requests };
}

/** Asks the model, one row at a time — outside any transaction. */
export async function askStage2(ai: AiService, prepared: Stage2Prepared): Promise<Stage2Outcome> {
  const out: Stage2Outcome = { drafts: [], asked: 0, failed: 0, stopped: false };
  if (ai.kind === "off") return { ...out, stopped: true };
  const system = basProposalSystem(prepared.accounts, prepared.examples);
  const schema = basProposalSchema(prepared.activeCodes);
  for (const r of prepared.requests) {
    const call = {
      task: BAS_PROPOSAL_TASK,
      promptVersion: BAS_PROPOSAL_VERSION,
      messages: [
        { role: "system" as const, content: system },
        { role: "user" as const, content: basProposalUser(r.row) },
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
    const a = res.data;
    out.drafts.push({
      targetId: r.targetId,
      factsHash: r.factsHash,
      payload: {
        basCode: a.basCode,
        alternatives: a.alternatives
          .filter((x) => x.basCode !== a.basCode)
          .map((x) => ({ basCode: x.basCode, why: x.why })),
      },
      confidence: Math.round(Math.min(a.confidence, MODEL_MAX_CONFIDENCE) * 100) / 100,
      reason: a.reason.trim() || "Proposed by the model",
      model: res.model,
    });
  }
  return out;
}

/** Writes the model's answers under the run, for the rows still without a category. */
export async function writeStage2(
  tx: TransactionClient,
  caller: CallerIdentity,
  runId: string,
  drafts: readonly Stage2Draft[],
): Promise<number> {
  if (drafts.length === 0) return 0;
  const open = new Set(
    (
      await banking.proposalInputs(
        tx,
        drafts.map((d) => d.targetId),
      )
    )
      .filter((i) => i.row.basCode === null)
      .map((i) => i.row.id),
  );
  const data: Prisma.ProposalCreateManyInput[] = drafts
    .filter((d) => open.has(d.targetId))
    .map((d) => ({
      tenantId: caller.tenantId,
      runId,
      targetType: "bank_transaction",
      targetId: d.targetId,
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
