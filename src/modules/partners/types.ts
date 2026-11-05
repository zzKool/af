// Public DTOs of the partners module. Plain types only — never Prisma types (constitution §2).
// Dates stay `Date` on the server surface; pages serialise at the client boundary.

export type PartnerType = "client" | "vendor" | "employee" | "authority";
/** `authority` (F129, D73): a tax agency — Skatteverket, the Swiss FTA — the partner of a *tax* row with no proof. */
export const PARTNER_TYPES: readonly PartnerType[] = ["client", "vendor", "employee", "authority"];

/**
 * The role a seeded partner plays for the *no proof needed* reasons (F129, D73): the bank (fees, interest), the
 * Swedish and the Swiss tax agency (tax, by the account's currency), the owner as employee (salary, a refund).
 * One per tenant (`partners_tenant_system_role_key`), set by the migration and `ensureSystemPartners`, never by a
 * form — the name, types, address and the active flag stay the owner's. Compared through `SYSTEM_ROLES` lookups.
 */
export type SystemRole = "bank" | "tax_agency_se" | "tax_agency_ch" | "owner";
export const SYSTEM_ROLES: readonly SystemRole[] = [
  "bank",
  "tax_agency_se",
  "tax_agency_ch",
  "owner",
];
export function isSystemRole(value: string | null | undefined): value is SystemRole {
  return !!value && (SYSTEM_ROLES as readonly string[]).includes(value);
}

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
  paymentTermsDays: number | null;
  externalIdentifiers: ExternalIdentifier[];
  email: string | null;
  phone: string | null;
  address: PartnerAddress | null;
  /** read-only on every surface: the migration and `ensureSystemPartners` set it (F129) */
  systemRole: SystemRole | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

/** Compact row for pickers and search results. */
export type PartnerSummaryDto = Pick<
  PartnerDto,
  | "id"
  | "name"
  | "shortCode"
  | "types"
  | "defaultCurrency"
  | "defaultBasCategoryCode"
  | "systemRole"
>;

// --- the supplier match (specs/documents US1) ---
export type MatchQuery = {
  name?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  /** the partner type the caller wants (`vendor` for a supplier invoice); a matching type adds 10 */
  type?: PartnerType;
};

export type MatchablePartner = {
  id: string;
  name: string;
  vatNumber: string | null;
  address: string | null;
  types: string[];
};

export type PartnerMatch = {
  partnerId: string;
  name: string;
  score: number;
  /** min(100, round(score / 140 × 100)) */
  percent: number;
};

// --- contact persons (F08, specs/partners/spec.md) ---
export type PartnerContactDto = {
  id: string;
  partnerId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
};
