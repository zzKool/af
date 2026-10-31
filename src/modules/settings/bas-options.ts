// The one list builder for every BAS picker (F125): the tenant's activated accounts in chart order, named in the UI
// language (F95: the tenant's translation → the chart's English → Swedish), the Swedish name kept as the second line.
// The picker groups and searches; this only says what each account is. Replaces the per-module builders that each
// sorted their own way (alias first, favourites first, by code).
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { translationsSchema } from "./bas-preferences";
import type { BasOption } from "./types";

/** The name on screen: the tenant's own English → the chart's English → the Swedish canonical name. */
export function basDisplayName(c: {
  name: string;
  nameEn: string | null;
  translations?: unknown;
}): string {
  const own = translationsSchema.safeParse(c.translations);
  const mine = own.success ? own.data?.en?.trim() : undefined;
  return mine || c.nameEn?.trim() || c.name;
}

export async function basPickerOptions(tx: TransactionClient): Promise<BasOption[]> {
  const prefs = await tx.tenantBasPreference.findMany({
    include: { basCategory: true },
    orderBy: [{ basCategory: { classNum: "asc" } }, { basCategory: { code: "asc" } }],
  });
  return prefs.map((p) => {
    const c = p.basCategory;
    const name = basDisplayName({ name: c.name, nameEn: c.nameEn, translations: p.translations });
    const alias = p.shortCode?.trim() || c.suggestedAlias?.trim() || null;
    return {
      code: c.code,
      label: `${c.code} · ${name}${alias ? ` (${alias})` : ""}`,
      name,
      nameSv: name === c.name ? null : c.name,
      alias,
      classNum: c.classNum,
      favourite: p.isFavorite,
      useFor: p.useFor?.trim() || null,
    };
  });
}
