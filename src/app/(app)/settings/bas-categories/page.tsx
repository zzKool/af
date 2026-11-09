import { resolveAiProvider } from "@/kernel/ai/ai";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { Msg } from "@/kernel/i18n/msg";
import { BasCategoriesTab, SettingsSection } from "@/modules/settings/ui";

export default async function BasCategoriesSettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

  const tenantId = auth.tenantId;

  // Fetch initial data within tenant transaction
  const { categories, groups, preferences } = await withTenantTransaction(
    prisma,
    tenantId,
    async (tx) => {
      const cats = await tx.basCategory.findMany({
        orderBy: [{ classNum: "asc" }, { code: "asc" }],
      });
      const prefs = await tx.tenantBasPreference.findMany({
        include: { basCategory: true },
        orderBy: [{ basCategory: { classNum: "asc" } }, { basCategory: { code: "asc" } }],
      });
      // D68: BAS's account groups — the second level of the list
      const groups = await tx.basGroup.findMany({ orderBy: { code: "asc" } });
      return {
        categories: cats,
        groups,
        preferences: prefs.map((p) => ({
          ...p,
          translations: (p.translations as Record<string, unknown>) ?? null,
        })),
      };
    },
  );

  return (
    <SettingsSection title={<Msg k="settings.bas.title" />}>
      <BasCategoriesTab
        initialCategories={categories}
        groups={groups}
        initialPreferences={preferences}
        aiOn={resolveAiProvider().kind !== "off"}
      />
    </SettingsSection>
  );
}
