import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { BasCategoriesTab } from "@/modules/settings/components/bas-categories-tab";

export default async function BasCategoriesSettingsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Owner-only access — enforce RBAC server-side
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  if (member?.role !== "owner") redirect("/dashboard");

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
