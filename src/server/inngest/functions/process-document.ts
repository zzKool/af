import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { withInngestContext } from "../context";

/**
 * Process an uploaded document (OCR, metadata extraction).
 *
 * Story 5.1: Loads document, updates status to 'processing'.
 * Story 5.2 will add actual Azure Document Intelligence OCR call.
 */
export const processDocument = inngest.createFunction(
  { id: "process-document", retries: 3 },
  { event: "document/uploaded" },
  async ({ event, step }) => {
    const { tenantId, userId, documentId } = event.data;

    const result = await step.run("update-status-to-processing", async () => {
      return withInngestContext(tenantId, userId, async (tx, _caller, _audit) => {
        // Load document by ID — if not found, the event was from a rolled-back transaction
        const document = await tx.document.findUnique({
          where: { id: documentId },
        });

        if (!document) {
          throw new NonRetriableError(
            `Document ${documentId} not found — likely from a rolled-back transaction`,
          );
        }

        // Only transition from 'uploaded' — prevent regressing later states on retry
        if (document.status !== "uploaded") {
          return { documentId, status: document.status, skipped: true };
        }

        // Update status from 'uploaded' to 'processing'
        await tx.document.update({
          where: { id: documentId },
          data: { status: "processing" },
        });

        return { documentId, status: "processing" };
      });
    });

    return result;
  },
);
