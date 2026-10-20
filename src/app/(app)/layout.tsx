import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { Providers } from "@/kernel/ui/providers";
import { Sidebar } from "@/kernel/ui/shell/sidebar";
import { Topbar } from "@/kernel/ui/shell/topbar";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const auth = await requireCaller();
  const role = auth.role;

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
  const [userPref, user] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId: auth.userId }, select: { locale: true } }),
    prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true, name: true } }),
  ]);
  const currentTenant = tenants.find((t) => t.id === auth.tenantId);

  return (
    <Providers>
      <LocaleProvider initialLocale={userPref?.locale ?? null}>
        {/* Full-width app shell (D19): sidebar · topbar · content that fills the viewport. */}
        <div className="flex h-screen">
          <Sidebar role={role} tenants={tenants} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar
              tenantName={currentTenant?.name ?? ""}
              userLabel={user?.name || user?.email || ""}
            />
            {/* main.overflow-auto is the intentional scroll container — do not change, sticky table headers depend on it */}
            <main className="min-h-0 flex-1 overflow-auto">{children}</main>
          </div>
        </div>
      </LocaleProvider>
    </Providers>
  );
}
