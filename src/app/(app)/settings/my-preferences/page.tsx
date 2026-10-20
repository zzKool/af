import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { MyPreferencesTab } from "@/modules/settings/ui";

export default async function MyPreferencesSettingsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Any authenticated user can access — no owner-only check
  // Direct Prisma query — UserPreference is user-scoped, no RLS
  const userPref = await prisma.userPreference.findUnique({
    where: { userId: auth.userId },
    select: { locale: true },
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">My Preferences</h1>
      <MyPreferencesTab initialLocale={userPref?.locale ?? null} />
    </div>
  );
}
