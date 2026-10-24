import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { browserLocale } from "@/kernel/i18n/request-locale";
import { TablePreferencesProvider } from "@/kernel/ui/data-table";
import { Providers } from "@/kernel/ui/providers";
import { AppShell } from "@/kernel/ui/shell/app-shell";
import { parseTheme } from "@/kernel/ui/theme";
import { ThemeSync } from "@/kernel/ui/theme-sync";
import { rowsToJustifyCount } from "@/modules/banking";
import { inboxOpenCount } from "@/modules/documents";
import { overdueInvoiceCount } from "@/modules/invoices";
import { upsertTablePreferenceAction } from "@/modules/settings";
import { overdueSupplierInvoiceCount } from "@/modules/supplier-invoices";

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
  const [userPref, user, tablePrefs, browser, counts] = await Promise.all([
    prisma.userPreference.findUnique({
      where: { userId: auth.userId },
      select: { locale: true, theme: true },
    }),
    prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true, name: true } }),
    // the user's table layouts (user-scoped, no RLS) — every DataTable reads its own under its key
    prisma.tablePreference.findMany({
      where: { userId: auth.userId },
      select: { tableKey: true, preferences: true },
    }),
    // no preference = the browser's language, taken from the request so server pages and client agree
    browserLocale(),
    // F72: the sidebar's open work — the owner's to-do, like the dashboard's; one cheap read per module, in the
    // tenant's own transaction (never the dashboard's computation)
    can(auth, "create", "bank_transaction")
      ? withTenantTransaction(prisma, auth.tenantId, async (tx) => {
          const today = createClock().today();
          const [banking, documents, invoices, supplierInvoices] = await Promise.all([
            rowsToJustifyCount(tx),
            inboxOpenCount(tx, auth),
            overdueInvoiceCount(tx, today),
            overdueSupplierInvoiceCount(tx, today),
          ]);
          return {
            "/banking": banking,
            "/documents": documents,
            "/invoices": invoices,
            "/supplier-invoices": supplierInvoices,
          };
        })
      : Promise.resolve({}),
  ]);
  const tableLayouts = Object.fromEntries(tablePrefs.map((p) => [p.tableKey, p.preferences]));

  return (
    <Providers>
      <ThemeSync theme={parseTheme(userPref?.theme)} />
      <LocaleProvider initialLocale={userPref?.locale ?? null} browserLocale={browser}>
        <TablePreferencesProvider initial={tableLayouts} save={upsertTablePreferenceAction}>
          {/* the D40 shell: top bar · sidebar · canvas (breadcrumb, page, docked details panel) */}
          <AppShell
            role={role}
            tenants={tenants}
            userLabel={user?.name || user?.email || ""}
            counts={counts}
          >
            {children}
          </AppShell>
        </TablePreferencesProvider>
      </LocaleProvider>
    </Providers>
  );
}
