import { aiStatus } from "@/kernel/ai/ai";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { Msg } from "@/kernel/i18n/msg";
import { PageHeader } from "@/kernel/ui/shell/page";
import { proposalStats } from "@/modules/linking";
import { AiSettings } from "@/modules/linking/ui";

// Settings → AI (F98): the local model's state, the proposals' acceptance per source, *Run now*.
export default async function AiSettingsPage() {
  const caller = await requireCaller();
  const status = await aiStatus();
  const { last30, last90 } = await withTenantTransaction(prisma, caller.tenantId, async (tx) => ({
    last30: await proposalStats(tx, 30),
    last90: await proposalStats(tx, 90),
  }));
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title={<Msg k="settings.ai.title" />}
        meta={<Msg k="settings.ai.description" />}
      />
      <AiSettings
        initial={{ status, last30, last90 }}
        canRun={can(caller, "update", "bank_transaction")}
      />
    </div>
  );
}
