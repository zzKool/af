import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { EntityPage } from "@/kernel/ui/shell/page";
import { NewInvoiceForm } from "@/modules/invoices/ui";
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
      title={type === "quote" ? "New quote" : "New invoice"}
      back={<Link href="/invoices">← Invoices</Link>}
    >
      <NewInvoiceForm clients={clients} initialType={type} today={createClock().today()} />
    </EntityPage>
  );
}
