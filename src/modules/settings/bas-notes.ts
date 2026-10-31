// The owner's *Use for* notes (F126, specs/ai/spec-suggest-from-first-entry.md FR-202): one English line per active
// BAS account saying what goes there — what the BAS proposals' prompt reads instead of any vendor → account table
// in code. The local model drafts them once; the owner reads, edits, confirms. A confirmed note is his: a new
// draft never overwrites it.
//
//   prepare (tx)   the active accounts without a confirmed note, in batches
//   ask (no tx)    the model, one batch at a time (`bas-use-for` v1)
//   write (tx)     the drafts, for the accounts still without a confirmed note

import type { AiService } from "@/kernel/ai/types";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { basDisplayName } from "./bas-options";
import { USE_FOR_MAX } from "./bas-preferences";
import {
  BAS_USE_FOR_TASK,
  BAS_USE_FOR_VERSION,
  basUseForMessages,
  basUseForSchema,
  type UseForAccount,
} from "./prompts/bas-use-for";

/** Accounts per model call — a short answer each, so a CPU box answers a batch in well under a minute. */
export const USE_FOR_BATCH = 12;

export type UseForDraft = { code: string; useFor: string };

/** The active accounts still without a confirmed note, batched. Empty when every account has one. */
export async function prepareUseForDrafts(tx: TransactionClient): Promise<UseForAccount[][]> {
  const prefs = await tx.tenantBasPreference.findMany({
    where: { OR: [{ useForState: null }, { useForState: "draft" }] },
    include: { basCategory: true },
    orderBy: [{ basCategory: { classNum: "asc" } }, { basCategory: { code: "asc" } }],
  });
  const accounts: UseForAccount[] = prefs.map((p) => ({
    code: p.basCode,
    name: basDisplayName({
      name: p.basCategory.name,
      nameEn: p.basCategory.nameEn,
      translations: p.translations,
    }),
    nameSv: p.basCategory.name,
    className: p.basCategory.className,
  }));
  const batches: UseForAccount[][] = [];
  for (let i = 0; i < accounts.length; i += USE_FOR_BATCH)
    batches.push(accounts.slice(i, i + USE_FOR_BATCH));
  return batches;
}

/** Asks the model, batch by batch — outside any transaction. Stops at the first unreachable answer. */
export async function askUseForDrafts(
  ai: AiService,
  batches: readonly UseForAccount[][],
): Promise<{ drafts: UseForDraft[]; failed: number; stopped: boolean }> {
  const out = { drafts: [] as UseForDraft[], failed: 0, stopped: false };
  if (ai.kind === "off") return { ...out, stopped: true };
  for (const batch of batches) {
    const call = {
      task: BAS_USE_FOR_TASK,
      promptVersion: BAS_USE_FOR_VERSION,
      messages: basUseForMessages(batch),
      schema: basUseForSchema(batch.map((a) => a.code)),
      maxTokens: 120 * batch.length,
    };
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
    const seen = new Set<string>();
    for (const n of res.data.notes) {
      const text = n.useFor.trim().slice(0, USE_FOR_MAX);
      if (!text || seen.has(n.code)) continue;
      seen.add(n.code);
      out.drafts.push({ code: n.code, useFor: text });
    }
  }
  return out;
}

/** Writes the drafts — never over a confirmed note (the owner's word wins, even one written while the model ran). */
export async function writeUseForDrafts(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  drafts: readonly UseForDraft[],
): Promise<number> {
  let written = 0;
  for (const d of drafts) {
    const existing = await tx.tenantBasPreference.findUnique({
      where: { tenantId_basCode: { tenantId: caller.tenantId, basCode: d.code } },
    });
    if (!existing || existing.useForState === "confirmed") continue;
    const updated = await tx.tenantBasPreference.update({
      where: { id: existing.id },
      data: { useFor: d.useFor, useForState: "draft" },
    });
    await audit.log({
      action: "update",
      entityType: "tenant_bas_preference",
      entityId: d.code,
      oldData: toAuditData(existing),
      newData: toAuditData(updated),
    });
    written++;
  }
  return written;
}

/** The owner confirms drafts as they are — these codes, or every draft. */
export async function confirmUseForNotes(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  codes?: readonly string[],
): Promise<ServiceResult<{ confirmed: number }>> {
  if (!can(caller, "manage", "tenant_settings"))
    return {
      error: { code: "FORBIDDEN", message: "Only the owner confirms notes", retryable: false },
    };
  const drafts = await tx.tenantBasPreference.findMany({
    where: { useForState: "draft", ...(codes ? { basCode: { in: [...codes] } } : {}) },
  });
  for (const d of drafts) {
    const updated = await tx.tenantBasPreference.update({
      where: { id: d.id },
      data: { useForState: "confirmed" },
    });
    await audit.log({
      action: "update",
      entityType: "tenant_bas_preference",
      entityId: d.basCode,
      oldData: toAuditData(d),
      newData: toAuditData(updated),
    });
  }
  return { data: { confirmed: drafts.length } };
}
