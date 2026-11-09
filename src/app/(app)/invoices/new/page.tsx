import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { EntityPage } from "@/kernel/ui/shell/page";
import { NewInvoiceForm, NewInvoiceSteps } from "@/modules/invoices/ui";
import { getPartners } from "@/modules/partners";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "create", subject: "invoice" });
  const params = await searchParams;
  const type = params.type === "quote" ? "quote" : "invoice";
  const clients = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const r = await getPartners(tx, { types: ["client"] });
    return (r.data ?? []).map((c) => ({ id: c.id, name: c.name, shortCode: c.shortCode }));
  });
  return (
    <EntityPage
      ground
      title={type === "quote" ? "New quote" : "New invoice"}
      back={<Link href="/invoices">← Invoices</Link>}
    >
      {/* F163: the form in its card on the ground, what happens next beside it */}
      <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="pulse-card p-6">
          <NewInvoiceForm
            clients={clients}
            initialType={type}
            initialPartnerId={typeof params.partner === "string" ? params.partner : undefined}
            today={createClock().today()}
          />
        </section>
        <NewInvoiceSteps />
      </div>
    </EntityPage>
  );
}
