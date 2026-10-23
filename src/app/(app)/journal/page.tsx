import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  categoryOptions,
  JOURNAL_COLUMN_KEYS,
  JOURNAL_DEFAULT_SORT,
  listJournalEntries,
  partnerOptions,
} from "@/modules/journal";
import { JournalTable, NewEntryButton } from "@/modules/journal/ui";
import { getUserPreferences } from "@/modules/settings";

// The ledger — the URL is the query (D20); sums of the SEK base on the filtered set.
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "journal_entry" });
  const query = parseListQuery(await searchParams, {
    columns: JOURNAL_COLUMN_KEYS,
    defaultSort: JOURNAL_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [result, categories, partners, prefs] = await Promise.all([
      listJournalEntries(tx, query),
      categoryOptions(tx, auth),
      partnerOptions(tx),
      getUserPreferences(tx, auth),
    ]);
    return { result, categories, partners, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "journal_entry");

  return (
    <ListPage
      title={t("journal.title")}
      meta={t("journal.meta.entries", { count: data.result.total })}
      actions={
        canWrite && (
          <NewEntryButton
            today={createClock().today()}
            categories={data.categories}
            partners={data.partners}
          />
        )
      }
    >
      <JournalTable
        result={{
          ...data.result,
          rows: data.result.rows.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
        }}
        categories={data.categories}
        partners={data.partners}
        canWrite={canWrite}
      />
    </ListPage>
  );
}
