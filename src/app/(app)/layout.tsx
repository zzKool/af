import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/domain/sidebar";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { Providers } from "@/components/shared/providers";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import type { CallerIdentity } from "@/types/caller-identity";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth) redirect("/login");
  if (!auth.tenantId) redirect("/login");

  // Resolve role for sidebar filtering (mirrors tenant middleware logic)
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  const role: CallerIdentity["role"] = member?.role === "owner" ? "owner" : "accountant";

  // Fetch all tenants the user belongs to — reads from Tenant model (source of truth for business data).
  // Uses per-tenant RLS-scoped transactions since tenants table has FORCE ROW LEVEL SECURITY.
  const memberships = await prisma.member.findMany({
    where: { userId: auth.userId },
    select: { organizationId: true },
  });
  const tenants = (
    await Promise.all(
      memberships.map(async (m) =>
        withTenantTransaction(prisma, m.organizationId, async (tx) =>
          tx.tenant.findUnique({
            where: { id: m.organizationId },
            select: { id: true, name: true },
          }),
        ),
      ),
    )
  ).filter(Boolean) as { id: string; name: string }[];

  // Fetch user locale preference — direct Prisma query, NOT withTenantTransaction
  // (UserPreference is user-scoped with no RLS)
  const userPref = await prisma.userPreference.findUnique({
    where: { userId: auth.userId },
    select: { locale: true },
  });

  return (
    <Providers>
      <LocaleProvider initialLocale={userPref?.locale ?? null}>
        <div className="flex h-screen">
          <Sidebar role={role} tenants={tenants} />
          {/* main.overflow-auto is the intentional scroll container — do not change, future sticky positioning depends on it */}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </LocaleProvider>
    </Providers>
  );
}
