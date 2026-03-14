import { inngest } from "../client";
import { withInngestContext } from "../context";

/**
 * Process an uploaded document (OCR, metadata extraction).
 *
 * Spike: proves DB access works using an existing table (partners).
 * Story 5.2 replaces the spike body with actual document processing.
 */
export const processDocument = inngest.createFunction(
  { id: "process-document", retries: 3 },
  { event: "document/uploaded" },
  async ({ event, step }) => {
    const { tenantId, userId } = event.data;

    const result = await step.run("verify-db-access", async () => {
      return withInngestContext(tenantId, userId, async (tx, caller) => {
        // Read: proves RLS-scoped query works inside Inngest
        const count = await tx.partner.count();
        return {
          tenantId,
          partnerCount: count,
          callerSource: caller.source,
        };
      });
    });

    return result;
  },
);
