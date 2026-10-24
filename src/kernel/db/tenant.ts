// Read API of the `tenants` row (kernel — tenancy.prisma) for the modules (F66). The row is RLS-scoped: read
// it through the tenant transaction. Writes stay with the settings module's company page (`updateTenantProfile`).
import type { TransactionClient } from "./tenant-client";

export type TenantProfile = {
  name: string;
  orgNumber: string | null;
  address: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  logoUrl: string | null;
  currency: string;
};

/** The company's own profile (name, identifiers, contact line, logo, currency); null when no row is visible. */
export async function tenantProfile(
  tx: TransactionClient,
  tenantId: string,
): Promise<TenantProfile | null> {
  return tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      orgNumber: true,
      address: true,
      email: true,
      website: true,
      phone: true,
      logoUrl: true,
      currency: true,
    },
  });
}
