// The invoice as a PDF, made on demand (F145): a draft's preview, or an issued document whose stored PDF is not
// there yet. The same print route the issue job renders (D7) — what you preview is what will be stored. When
// Chromium cannot run, the page says why instead of spinning (the job's failure was only in the log).
import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { translator } from "@/kernel/i18n/translate";
import { logger } from "@/kernel/logging/logger";
import { renderPathToPdf } from "@/kernel/pdf/pdf";
import { getInvoice, printPath } from "@/modules/invoices";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await requireCaller({ action: "read", subject: "invoice" });
  const inv = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
    getInvoice(tx, id, createClock().today()),
  );
  if (!inv.data) return new Response("Not found", { status: 404 });
  const name = inv.data.number ? `${inv.data.number}.pdf` : `draft-${id.slice(0, 8)}.pdf`;
  try {
    const bytes = await renderPathToPdf(printPath(id), caller);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    logger.error({ invoiceId: id, reason }, "invoices.pdf: on-demand render failed");
    const t = translator("en");
    return new Response(t("invoices.pdf.failed", { reason }), {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
