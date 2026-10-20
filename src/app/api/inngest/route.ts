import { serve } from "inngest/next";
import { inngest } from "@/kernel/jobs/client";
import { processDocument } from "@/modules/documents";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocument],
});
