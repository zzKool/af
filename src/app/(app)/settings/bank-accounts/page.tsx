import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { Msg } from "@/kernel/i18n/msg";
import * as bankService from "@/modules/banking";
import { BankAccountsTab } from "@/modules/banking/ui";

export default async function BankAccountsSettingsPage() {
  const auth = await requireCaller({ action: "manage", subject: "tenant_settings" });

  const tenantId = auth.tenantId;
  const callerIdentity = {
    userId: auth.userId,
    tenantId,
    role: "owner" as const,
    source: "web" as const,
  };

  // Fetch initial data via service methods (single source of truth for queries)
  const { accounts, formats } = await withTenantTransaction(prisma, tenantId, async (tx) => {
    const [accountsResult, bankFormats] = await Promise.all([
      bankService.getBankAccounts(tx, callerIdentity),
      bankService.getBankFormats(tx),
    ]);

    return {
      accounts: (accountsResult.data ?? []).map((a) => ({
        id: a.id,
        accountAlias: a.accountAlias,
        accountNumber: a.accountNumber,
        currency: a.currency,
        bankFormatId: a.bankFormatId,
        iban: a.iban,
        bic: a.bic,
        role: a.role,
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
    <div className="p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-semibold">
        <Msg k="settings.bankAccounts.title" />
      </h1>
      <BankAccountsTab initialAccounts={accounts} bankFormats={formats} />
    </div>
  );
}
