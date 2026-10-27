// The option lists the categorise form and the rule dialog need: the tenant's active BAS set (favourites
// first) as `657 · Bankkostnader`, and the active partners. Server-side helpers for pages.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";

export type CategoryOption = { code: string; label: string };
export type PartnerOption = { id: string; name: string; defaultBasCode: string | null };

export async function categoryOptions(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<CategoryOption[]> {
  const prefs = await settings.getTenantBasPreferences(tx, caller);
  const list = (prefs.data ?? [])
    .slice()
    .sort(
      (a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.basCode.localeCompare(b.basCode),
    );
  return list.map((p) => ({
    code: p.basCode,
    label: `${p.basCode} · ${p.basCategory.name}${p.shortCode ? ` (${p.shortCode})` : ""}`,
  }));
}

export async function partnerOptions(tx: TransactionClient): Promise<PartnerOption[]> {
  const all = await partners.getPartners(tx, {});
  return (all.data ?? [])
    .map((p) => ({ id: p.id, name: p.name, defaultBasCode: p.defaultBasCategoryCode ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
