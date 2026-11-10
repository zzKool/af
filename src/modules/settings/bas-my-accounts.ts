// F187 (D84): *Use my usual accounts* — the owner's set (`MY_ACCOUNT_SET`) becomes the tenant's active BAS accounts,
// so every picker and the model's proposals offer only those. One plan (read), one apply (write):
//
//   activate   the set's accounts not active yet, each with its *Use for* note (confirmed)
//   notes      on the set's active accounts: the note where there is none, or only the model's draft —
//              a confirmed note is the owner's word and is never overwritten
//   deactivate (optional, the dialog's box) the other active accounts — EXCEPT those holding the owner's own data
//              (a short code, a confirmed note, a favourite, a translation) or carried by any record
//
// Every where names the tenant: RLS scopes the app, the seed runs as the migration role.
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { basCodesInUse } from "./bas-in-use";
import { basDisplayName } from "./bas-options";
import { MY_ACCOUNT_SET } from "./my-accounts";
import type { BasPreferenceRow, KeptReason, MyAccountsPlan } from "./types";

const forbidden = {
  error: {
    code: "FORBIDDEN" as const,
    message: "Only the owner sets the active accounts",
    retryable: false,
  },
};

/** The owner's own words on an account: a translation with any text in it. */
function hasTranslation(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  return Object.values(t as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.trim() !== "",
  );
}

async function computePlan(tx: TransactionClient, tenantId: string): Promise<MyAccountsPlan> {
  const set = new Map(MY_ACCOUNT_SET.map((a) => [a.code, a]));
  const prefs = await tx.tenantBasPreference.findMany({
    where: { tenantId },
    include: { basCategory: true },
    orderBy: { basCode: "asc" },
  });
  const active = new Map(prefs.map((p) => [p.basCode, p]));
  const inUse = await basCodesInUse(tx, tenantId);

  const plan: MyAccountsPlan = { activate: [], notes: [], deactivate: [], kept: [] };
  for (const a of MY_ACCOUNT_SET) {
    const p = active.get(a.code);
    if (!p) plan.activate.push(a.code);
    if (p?.useForState !== "confirmed") plan.notes.push(a.code);
  }
  for (const p of prefs) {
    if (set.has(p.basCode)) continue;
    const reasons: KeptReason[] = [];
    if (p.shortCode?.trim()) reasons.push("shortCode");
    if (p.useForState === "confirmed" && p.useFor?.trim()) reasons.push("note");
    if (p.isFavorite) reasons.push("favourite");
    if (hasTranslation(p.translations)) reasons.push("translations");
    const uses = inUse.get(p.basCode) ?? 0;
    if (uses > 0) reasons.push("inUse");
    if (reasons.length === 0) plan.deactivate.push(p.basCode);
    else
      plan.kept.push({
        code: p.basCode,
        label: `${p.basCode} · ${basDisplayName({
          name: p.basCategory.name,
          nameEn: p.basCategory.nameEn,
          translations: p.translations,
        })}`,
        reasons,
        uses,
      });
  }
  return plan;
}

/** What *Use my usual accounts* would do now — nothing written. */
export async function planMyAccounts(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<ServiceResult<MyAccountsPlan>> {
  if (!can(caller, "manage", "tenant_settings")) return forbidden;
  return { data: await computePlan(tx, caller.tenantId) };
}

/** The tenant's active accounts, as Settings → BAS lists them. */
export async function listBasPreferenceRows(
  tx: TransactionClient,
  tenantId: string,
): Promise<BasPreferenceRow[]> {
  const prefs = await tx.tenantBasPreference.findMany({
    where: { tenantId },
    include: { basCategory: true },
    orderBy: [{ basCategory: { classNum: "asc" } }, { basCategory: { code: "asc" } }],
  });
  return prefs.map((p) => ({
    id: p.id,
    basCode: p.basCode,
    isFavorite: p.isFavorite,
    shortCode: p.shortCode,
    translations: (p.translations as Record<string, unknown> | null) ?? null,
    useFor: p.useFor,
    useForState: p.useForState,
    basCategory: {
      code: p.basCategory.code,
      name: p.basCategory.name,
      nameEn: p.basCategory.nameEn,
      nameFr: p.basCategory.nameFr,
      className: p.basCategory.className,
      classNum: p.basCategory.classNum,
      isCommon: p.basCategory.isCommon,
      suggestedAlias: p.basCategory.suggestedAlias,
      groupCode: p.basCategory.groupCode,
      kind: p.basCategory.kind,
      parentCode: p.basCategory.parentCode,
    },
  }));
}

/**
 * Applies the plan: the set active with its notes; with `deactivateOthers`, the other accounts that hold nothing
 * removed. Idempotent — a second run activates, writes and removes nothing. Audited per account.
 */
export async function applyMyAccounts(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { deactivateOthers: boolean },
): Promise<
  ServiceResult<{
    activated: number;
    notes: number;
    deactivated: number;
    kept: number;
    preferences: BasPreferenceRow[];
  }>
> {
  if (!can(caller, "manage", "tenant_settings")) return forbidden;
  const { tenantId } = caller;
  const plan = await computePlan(tx, tenantId);
  const notes = new Map(MY_ACCOUNT_SET.map((a) => [a.code, a.useFor]));
  const activating = new Set(plan.activate);

  for (const code of plan.activate) {
    const created = await tx.tenantBasPreference.create({
      data: {
        tenantId,
        basCode: code,
        useFor: notes.get(code) ?? null,
        useForState: "confirmed",
        createdBy: caller.userId,
        source: caller.source,
      },
    });
    await audit.log({
      action: "create",
      entityType: "tenant_bas_preference",
      entityId: code,
      newData: toAuditData(created),
    });
  }

  let noted = 0;
  for (const code of plan.notes) {
    if (activating.has(code)) {
      noted++;
      continue;
    }
    const existing = await tx.tenantBasPreference.findUnique({
      where: { tenantId_basCode: { tenantId, basCode: code } },
    });
    if (!existing || existing.useForState === "confirmed") continue;
    const updated = await tx.tenantBasPreference.update({
      where: { id: existing.id },
      data: { useFor: notes.get(code) ?? null, useForState: "confirmed" },
    });
    await audit.log({
      action: "update",
      entityType: "tenant_bas_preference",
      entityId: code,
      oldData: toAuditData(existing),
      newData: toAuditData(updated),
    });
    noted++;
  }

  let deactivated = 0;
  if (input.deactivateOthers) {
    for (const code of plan.deactivate) {
      const existing = await tx.tenantBasPreference.findUnique({
        where: { tenantId_basCode: { tenantId, basCode: code } },
      });
      if (!existing) continue;
      await tx.tenantBasPreference.delete({ where: { id: existing.id } });
      await audit.log({
        action: "delete",
        entityType: "tenant_bas_preference",
        entityId: code,
        oldData: toAuditData(existing),
      });
      deactivated++;
    }
  }

  return {
    data: {
      activated: plan.activate.length,
      notes: noted,
      deactivated,
      kept: plan.kept.length,
      preferences: await listBasPreferenceRows(tx, tenantId),
    },
  };
}
