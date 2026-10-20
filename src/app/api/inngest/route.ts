import { serve } from "inngest/next";
import { inngest } from "@/kernel/jobs/client";
import { processDocument } from "@/modules/documents/jobs/process-document";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocument],
});
