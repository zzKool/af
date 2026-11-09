import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { Msg } from "@/kernel/i18n/msg";
import { parseTheme } from "@/kernel/ui/theme";
import { MyPreferencesTab, SettingsSection } from "@/modules/settings/ui";

export default async function MyPreferencesSettingsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Any authenticated user can access — no owner-only check
  // Direct Prisma query — UserPreference is user-scoped, no RLS
  const userPref = await prisma.userPreference.findUnique({
    where: { userId: auth.userId },
    select: { locale: true, theme: true },
  });

  return (
    <SettingsSection title={<Msg k="settings.preferences.title" />}>
      <MyPreferencesTab
        initialLocale={userPref?.locale ?? null}
        initialTheme={parseTheme(userPref?.theme)}
      />
    </SettingsSection>
  );
}
