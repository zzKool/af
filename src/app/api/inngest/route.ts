import { serve } from "inngest/next";
import { inngest } from "@/server/inngest/client";
import { processDocument } from "@/server/inngest/functions/process-document";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocument],
});
