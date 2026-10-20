// Public DTOs of the partners module. Plain types only — never Prisma types (constitution §2).
// Dates stay `Date` on the server surface; pages serialise at the client boundary.

export type PartnerType = "client" | "vendor" | "employee";

export type ExternalIdentifier = { label: string; value: string };

export type PartnerAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
};

export type PartnerDto = {
  id: string;
  tenantId: string;
  name: string;
  /** `VA` — the invoice series key is `{shortCode}{yy}` (D5). */
  shortCode: string | null;
  orgNumber: string | null;
  vatNumber: string | null;
  types: string[];
  defaultCurrency: string | null;
  defaultLanguage: string | null;
  defaultBasCategoryCode: string | null;
  externalIdentifiers: ExternalIdentifier[];
  email: string | null;
  phone: string | null;
  address: PartnerAddress | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

/** Compact row for pickers and search results. */
export type PartnerSummaryDto = Pick<
  PartnerDto,
  "id" | "name" | "shortCode" | "types" | "defaultCurrency" | "defaultBasCategoryCode"
>;
