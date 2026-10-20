import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { BasCategoriesTab } from "@/modules/settings/ui";

export default async function BasCategoriesSettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

  const tenantId = auth.tenantId;

  // Fetch initial data within tenant transaction
  const { categories, preferences } = await withTenantTransaction(prisma, tenantId, async (tx) => {
    const [cats, prefs] = await Promise.all([
      tx.basCategory.findMany({
        orderBy: [{ classNum: "asc" }, { code: "asc" }],
      }),
      tx.tenantBasPreference.findMany({
        include: { basCategory: true },
        orderBy: [{ basCategory: { classNum: "asc" } }, { basCategory: { code: "asc" } }],
      }),
    ]);
    return {
      categories: cats,
      preferences: prefs.map((p) => ({
        ...p,
        translations: (p.translations as Record<string, unknown>) ?? null,
      })),
    };
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">BAS Categories</h1>
      <BasCategoriesTab initialCategories={categories} initialPreferences={preferences} />
    </div>
  );
}
