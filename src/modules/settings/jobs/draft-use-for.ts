// F126: *Draft with AI* on Settings → BAS — the model drafts a *Use for* note for every active account without a
// confirmed one. A job, because the model is called outside any transaction (constitution) and a CPU box takes a
// minute or two for the whole set; the owner reloads to read the drafts.
import { createAiService } from "@/kernel/ai/ai";
import type { AiService } from "@/kernel/ai/types";
import { withJobContext } from "@/kernel/jobs/context";
import type { JobDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import { askUseForDrafts, prepareUseForDrafts, writeUseForDrafts } from "../bas-notes";

export type DraftUseForData = { tenantId: string; userId: string };

export async function draftUseFor(
  data: DraftUseForData,
  ai: AiService = createAiService(),
): Promise<{ accounts: number; drafted: number; failed: number; stopped: boolean }> {
  const batches = await withJobContext(data.tenantId, data.userId, (tx) => prepareUseForDrafts(tx));
  const accounts = batches.reduce((n, b) => n + b.length, 0);
  const asked = await askUseForDrafts(ai, batches);
  const drafted = asked.drafts.length
    ? await withJobContext(data.tenantId, data.userId, (tx, caller, audit) =>
        writeUseForDrafts(tx, caller, audit, asked.drafts),
      )
    : 0;
  const result = { accounts, drafted, failed: asked.failed, stopped: asked.stopped };
  // counts only (D51)
  logger.info({ tenantId: data.tenantId, ...result }, "settings.draft-use-for: done");
  return result;
}

export const draftUseForJob: JobDefinition<DraftUseForData> = {
  name: "settings.draft-use-for",
  options: { retryLimit: 1, retryDelay: 60, expireInSeconds: 1_800 },
  handler: async (data) => {
    await draftUseFor(data);
  },
  onDeadLetter: async (data, ctx) => {
    logger.error(
      { tenantId: data.tenantId, failure: ctx.failure },
      "settings.draft-use-for: failed",
    );
  },
};

export const settingsJobs = [draftUseForJob] as const;
