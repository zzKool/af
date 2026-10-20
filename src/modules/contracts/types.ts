// Public DTOs of the contracts module. Plain types only — never Prisma types (constitution §2).
// Money crosses the surface as a decimal string (docs/decimal-currency.md); dates stay `Date` on the server surface.

export type ExternalReference = { label: string; value: string };

export type ContractDto = {
  id: string;
  tenantId: string;
  name: string;
  partnerId: string;
  startDate: Date;
  endDate: Date | null;
  assignedEmployeeId: string | null;
  /** Decimal as string, e.g. "1200.00" — null when no rate is set. */
  billingRate: string | null;
  currency: string | null;
  paymentTerms: string | null;
  vatRegistrationId: string | null;
  externalReferences: ExternalReference[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};
