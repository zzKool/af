// The option lists the categorise form and the rule dialog need: the tenant's active BAS set (favourites
// first) as `657 · Bankkostnader`, and the active partners. Server-side helpers for pages.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as partners from "@/modules/partners";
import type { BasOption } from "@/modules/settings";
import * as settings from "@/modules/settings";

export type CategoryOption = BasOption;
export type PartnerOption = { id: string; name: string; defaultBasCode: string | null };

/** The tenant's active BAS set as the picker takes it (F125: settings' one builder; the picker groups and searches). */
export async function categoryOptions(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<CategoryOption[]> {
  return settings.basPickerOptions(tx);
}

export async function partnerOptions(tx: TransactionClient): Promise<PartnerOption[]> {
  const all = await partners.getPartners(tx, {});
  return (all.data ?? [])
    .map((p) => ({ id: p.id, name: p.name, defaultBasCode: p.defaultBasCategoryCode ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
