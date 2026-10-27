// The per-diem breakdown PDF (D29): rendered by a job from `/print/per-diem/[groupId]`, stored as the per-diem
// expense's receipt (`Ex213-Tr-02_2026-03-21_.pdf`, generated), linked `created_from` from the expense (an
// earlier breakdown's link is replaced; the old document stays). Idempotent: `per_diem_document_id` marks it done.
import { withJobContext } from "@/kernel/jobs/context";
import type { JobContext, JobDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import { renderPathToPdf } from "@/kernel/pdf/pdf";
import { createStorageService } from "@/kernel/storage/storage";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as linking from "@/modules/linking";
import { expenseDocumentKey } from "@/modules/numbering";

export interface RenderPerDiemData {
  tenantId: string;
  userId: string;
  groupId: string;
}

export function perDiemPrintPath(groupId: string): string {
  return `/print/per-diem/${groupId}`;
}

export type Renderer = (
  path: string,
  identity: { tenantId: string; userId: string },
) => Promise<Buffer>;

export async function renderPerDiem(
  { tenantId, userId, groupId }: RenderPerDiemData,
  render: Renderer = renderPathToPdf,
): Promise<void> {
  const target = await withJobContext(tenantId, userId, async (tx) => {
    const trip = await tx.trip.findUnique({ where: { groupId } });
    if (!trip || !trip.perDiemExpenseId || !trip.computed) return null;
    if (trip.perDiemDocumentId) return { done: true as const };
    const expense = await expenses.getExpense(tx, trip.perDiemExpenseId);
    if (!expense) return null;
    return { done: false as const, tripId: trip.id, expense };
  });
  if (!target) {
    logger.warn(
      { groupId },
      "traktamente.render-per-diem: no computed trip with an expense, skipping",
    );
    return;
  }
  if (target.done) return;

  const bytes = await render(perDiemPrintPath(groupId), { tenantId, userId });

  const storage = createStorageService();
  await withJobContext(tenantId, userId, async (tx, caller, audit) => {
    const key = expenseDocumentKey(target.expense.key, target.expense.date);
    const stored = await documents.storeGeneratedDocument(tx, caller, audit, storage, {
      bytes,
      businessKey: key,
      fileName: `${key}.pdf`,
      mimeType: "application/pdf",
      prefixType: "expense",
    });
    if (stored.error) throw new Error(`traktamente.render-per-diem: ${stored.error.message}`);
    // an earlier breakdown's created_from link goes (one document per entity); the document itself stays
    const touching = await linking.linksTouching(tx, "expense", [target.expense.id], {
      kinds: ["created_from"],
    });
    // the expense's own (from it); a link pointing at it stays
    const previous = touching.filter(
      (l) => l.from.type === "expense" && l.from.id === target.expense.id,
    );
    for (const l of previous) {
      const removed = await linking.removeLink(tx, caller, audit, l.id);
      if (removed.error) throw new Error(`traktamente.render-per-diem: ${removed.error.message}`);
    }
    const link = await linking.createLink(tx, caller, audit, {
      from: { type: "expense", id: target.expense.id },
      to: { type: "document", id: stored.data.id },
      kind: "created_from",
    });
    if (link.error) throw new Error(`traktamente.render-per-diem: ${link.error.message}`);
    await tx.trip.update({
      where: { id: target.tripId },
      data: { perDiemDocumentId: stored.data.id },
    });
    await audit.log({
      action: "update",
      entityType: "trip",
      entityId: target.tripId,
      newData: { perDiemDocumentId: stored.data.id, businessKey: key },
    });
  });
  logger.info({ groupId, key: target.expense.key }, "traktamente.render-per-diem: stored");
}

/** After the last retry (F110): the failure goes on the trip's trail. */
export async function markPerDiemFailed(
  { tenantId, userId, groupId }: RenderPerDiemData,
  ctx: JobContext,
): Promise<void> {
  logger.error(
    { groupId, failure: ctx.failure },
    "traktamente.render-per-diem: failed after all retries",
  );
  await withJobContext(tenantId, userId, async (tx, _caller, audit) => {
    const trip = await tx.trip.findUnique({
      where: { groupId },
      select: { id: true, perDiemDocumentId: true },
    });
    if (!trip || trip.perDiemDocumentId) return;
    await audit.log({
      action: "update",
      entityType: "trip",
      entityId: trip.id,
      newData: {
        perDiemRender: "failed",
        error: ctx.failure?.error ?? "unknown error",
        attempts: ctx.failure?.attempts ?? null,
      },
    });
  });
}

export const renderPerDiemJob: JobDefinition<RenderPerDiemData> = {
  name: "traktamente.render-per-diem",
  options: {
    policy: "exclusive",
    retryLimit: 5,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 120,
  },
  handler: (data) => renderPerDiem(data),
  onDeadLetter: markPerDiemFailed,
};

export const traktamenteJobs = [renderPerDiemJob];
