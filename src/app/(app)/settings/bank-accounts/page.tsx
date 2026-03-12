import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BankAccountsTab } from "@/components/settings/bank-accounts-tab";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";

export default async function BankAccountsSettingsPage() {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  // Owner-only access — enforce RBAC server-side
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  if (member?.role !== "owner") redirect("/dashboard");

  const tenantId = auth.tenantId;

  // Fetch initial data: bank accounts (tenant-scoped) and bank formats (app-level)
  const { accounts, formats } = await withTenantTransaction(prisma, tenantId, async (tx) => {
    const [bankAccounts, bankFormats] = await Promise.all([
      tx.bankAccount.findMany({
        include: { bankFormat: true },
        orderBy: [{ accountNumber: "asc" }, { currency: "asc" }],
      }),
      tx.bankFormat.findMany({
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      accounts: bankAccounts.map((a) => ({
        id: a.id,
        accountAlias: a.accountAlias,
        accountNumber: a.accountNumber,
        currency: a.currency,
        bankFormatId: a.bankFormatId,
        bankFormat: {
          id: a.bankFormat.id,
          name: a.bankFormat.name,
          bankName: a.bankFormat.bankName,
          delimiter: a.bankFormat.delimiter,
          decimalSeparator: a.bankFormat.decimalSeparator,
          dateFormat: a.bankFormat.dateFormat,
          encoding: a.bankFormat.encoding,
        },
      })),
      formats: bankFormats.map((f) => ({
        id: f.id,
        name: f.name,
        bankName: f.bankName,
        delimiter: f.delimiter,
        decimalSeparator: f.decimalSeparator,
        dateFormat: f.dateFormat,
        encoding: f.encoding,
      })),
    };
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Bank Accounts</h1>
      <BankAccountsTab initialAccounts={accounts} bankFormats={formats} />
    </div>
  );
}
