import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { Msg } from "@/kernel/i18n/msg";
import * as bankService from "@/modules/banking";
import { BankAccountsTab, PrivateInstruments } from "@/modules/banking/ui";
import { SettingsSection } from "@/modules/settings/ui";

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
  const { accounts, formats, privateInstruments } = await withTenantTransaction(
    prisma,
    tenantId,
    async (tx) => {
      const accountsResult = await bankService.getBankAccounts(tx, callerIdentity);
      const bankFormats = await bankService.getBankFormats(tx);
      // the statement accounts (a format each) and the owner's private instruments (none, F114) — two lists
      const statementAccounts = (accountsResult.data ?? []).flatMap((a) =>
        a.bankFormat && a.bankFormatId && bankService.STATEMENT_ROLES.includes(a.role)
          ? [{ ...a, bankFormat: a.bankFormat, bankFormatId: a.bankFormatId }]
          : [],
      );

      return {
        privateInstruments: (accountsResult.data ?? [])
          .filter((a) => bankService.payerKindOf(a.role) === "private")
          .map((a) => ({ id: a.id, label: bankService.accountLabel(a), currency: a.currency })),
        accounts: statementAccounts.map((a) => ({
          id: a.id,
          accountAlias: a.accountAlias,
          accountNumber: a.accountNumber,
          currency: a.currency,
          bankFormatId: a.bankFormatId,
          iban: a.iban,
          bic: a.bic,
          role: a.role as "main" | "savings",
          imports: a.imports,
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
    },
  );

  return (
    <>
      <SettingsSection title={<Msg k="settings.bankAccounts.title" />}>
        <BankAccountsTab initialAccounts={accounts} bankFormats={formats} />
      </SettingsSection>
      {/* the owner's own cards (D76): their own card, their own heading */}
      <section className="pulse-card p-5">
        <PrivateInstruments initial={privateInstruments} />
      </section>
    </>
  );
}
