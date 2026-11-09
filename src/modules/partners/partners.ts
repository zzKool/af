import { z } from "zod/v4";
import type { Partner, Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { tenantMembers, userName } from "@/kernel/auth/users";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { CURRENCIES, type Currency } from "@/kernel/nav/constants";
import { uuid } from "@/kernel/validation/scalars";
import { getBasCategory, isBasActivated } from "@/modules/settings";
import type {
  ExternalIdentifier,
  PartnerAddress,
  PartnerDto,
  PartnerSummaryDto,
  PartnerType,
  SystemRole,
} from "./types";
import { isSystemRole, PARTNER_TYPES, SYSTEM_ROLES } from "./types";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

// --- Zod Schemas ---

export const partnerTypeSchema = z.enum(PARTNER_TYPES as [PartnerType, ...PartnerType[]]);

const externalIdentifierSchema = z.object({
  label: z.string().min(1).max(50),
  value: z.string().min(1).max(100),
});

const addressSchema = z
  .object({
    street: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase())
      .optional(),
  })
  .optional();

export const shortCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{2,6}$/, "2–6 upper-case letters or digits")
  .optional()
  .or(z.literal(""));

export const createPartnerSchema = z.object({
  name: z.string().min(1).max(200),
  shortCode: shortCodeSchema,
  orgNumber: z.string().max(20).optional(),
  vatNumber: z.string().max(20).optional(),
  types: z.array(partnerTypeSchema).min(1, "At least one type required"),
  defaultCurrency: z.enum(["SEK", "CHF", "EUR", "USD"]).optional(),
  defaultLanguage: z.string().optional(),
  defaultBasCategoryCode: z.string().optional(),
  /** a supplier's payment terms — the due-date default of its invoices (null = 30 days) */
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  externalIdentifiers: z.array(externalIdentifierSchema).max(5).default([]),
  email: z.string().email().max(254).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  address: addressSchema,
});

export const updatePartnerSchema = createPartnerSchema.partial().extend({
  id: uuid,
});

export type CreatePartnerInput = z.input<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.input<typeof updatePartnerSchema>;

// --- FK Validation ---

async function validateBasCategoryFK(
  tx: TransactionClient,
  basCode: string,
): Promise<AppError | null> {
  // 1. Verify the BAS category exists globally
  if (!(await getBasCategory(tx, basCode))) {
    return { code: "NOT_FOUND", message: "BAS category not found", retryable: false };
  }
  // 2. Verify the tenant has activated this category
  if (!(await isBasActivated(tx, basCode))) {
    return {
      code: "VALIDATION_ERROR",
      message: "BAS category not activated for this tenant",
      retryable: false,
    };
  }
  return null;
}

// --- JSON columns (`external_identifiers`, `address`) — typed once, both ways ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isExternalIdentifier(v: unknown): v is ExternalIdentifier {
  return isRecord(v) && typeof v.label === "string" && typeof v.value === "string";
}

function isPartnerAddress(v: unknown): v is PartnerAddress {
  return isRecord(v) && Object.values(v).every((x) => x === undefined || typeof x === "string");
}

function toIdentifiers(json: Prisma.JsonValue): ExternalIdentifier[] {
  return Array.isArray(json) ? json.filter(isExternalIdentifier) : [];
}

function toAddress(json: Prisma.JsonValue | null): PartnerAddress | null {
  return isPartnerAddress(json) ? json : null;
}

function identifiersToJson(ids: ExternalIdentifier[]): Prisma.InputJsonArray {
  return ids.map((i) => ({ ...i }));
}

/** Drops the undefined keys — what JSON serialisation did before, now visible to the type. */
function addressToJson(
  address: PartnerAddress | null | undefined,
): Prisma.InputJsonObject | undefined {
  if (!address) return undefined;
  return Object.fromEntries(
    Object.entries(address).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

// --- DTO mapping (Prisma rows never leave the module) ---

export function toPartnerDto(row: Partner): PartnerDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    shortCode: row.shortCode,
    orgNumber: row.orgNumber,
    vatNumber: row.vatNumber,
    types: row.types,
    defaultCurrency: row.defaultCurrency,
    defaultLanguage: row.defaultLanguage,
    defaultBasCategoryCode: row.defaultBasCategoryCode,
    paymentTermsDays: row.paymentTermsDays,
    externalIdentifiers: toIdentifiers(row.externalIdentifiers),
    email: row.email,
    phone: row.phone,
    address: toAddress(row.address),
    systemRole: isSystemRole(row.systemRole) ? row.systemRole : null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

// --- Service Functions ---

export async function getPartners(
  tx: TransactionClient,
  options?: { includeInactive?: boolean; search?: string; types?: string[] },
): Promise<ServiceResult<PartnerDto[]>> {
  const where: Prisma.PartnerWhereInput = {};
  if (!options?.includeInactive) {
    where.isActive = true;
  }
  if (options?.types && options.types.length > 0) {
    where.types = { hasSome: options.types };
  }
  if (options?.search) {
    const term = options.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { orgNumber: { contains: term, mode: "insensitive" } },
    ];
  }
  const partners = await tx.partner.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return { data: partners.map(toPartnerDto) };
}

export async function getPartner(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<PartnerDto>> {
  const partner = await tx.partner.findUnique({ where: { id } });
  if (!partner) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }
  return { data: toPartnerDto(partner) };
}

// --- one partner per name / VAT number (D70, F124 (4), 2026-10-29) ---

/** The name as the rule compares it: case and runs of spaces ignored. */
export const foldPartnerName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
/** The VAT number as the rule compares it: spaces, dots and dashes ignored, upper case (`SE 5566-77` = `SE556677`). */
export const foldVatNumber = (vat: string) => vat.replace(/[\s.-]/g, "").toUpperCase();

/**
 * A supplier created ten times from the match card (the owner's first proof, 2026-10-29): within a tenant two
 * partners may not share a name (folded) or a VAT number (folded), deactivated ones included — the refusal names
 * the existing one so the caller can use it instead (`details.existingId` / `existingName` / `field`).
 */
async function partnerDuplicate(
  tx: TransactionClient,
  input: { name?: string | null; vatNumber?: string | null },
  exceptId?: string,
): Promise<AppError | null> {
  const name = input.name ? foldPartnerName(input.name) : null;
  const vat = input.vatNumber ? foldVatNumber(input.vatNumber) : null;
  if (!name && !vat) return null;
  // the tenant's partners, compared folded in memory (a solo company has dozens — the match card loads them too)
  const rows = await tx.partner.findMany({
    where: exceptId ? { id: { not: exceptId } } : {},
    select: { id: true, name: true, vatNumber: true },
  });

  const byName = name ? rows.find((r) => foldPartnerName(r.name) === name) : undefined;
  const byVat = vat
    ? rows.find((r) => r.vatNumber && foldVatNumber(r.vatNumber) === vat)
    : undefined;
  const hit = byName ?? byVat;
  if (!hit) return null;
  const field = byName ? "name" : "vatNumber";
  return {
    code: "DUPLICATE_ENTRY",
    message:
      field === "name"
        ? `A partner named “${hit.name}” exists already — use it instead`
        : `“${hit.name}” already carries the VAT number ${hit.vatNumber} — use it instead`,
    retryable: false,
    details: { existingId: hit.id, existingName: hit.name, field },
  };
}

export async function createPartner(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  data: CreatePartnerInput,
): Promise<ServiceResult<{ id: string }>> {
  // Validate types
  const typesResult = z.array(partnerTypeSchema).min(1).safeParse(data.types);
  if (!typesResult.success) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "At least one valid type required",
        retryable: false,
      },
    };
  }

  // Validate external identifiers shape
  if (data.externalIdentifiers && data.externalIdentifiers.length > 0) {
    const eiResult = z.array(externalIdentifierSchema).max(5).safeParse(data.externalIdentifiers);
    if (!eiResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external identifiers",
          retryable: false,
        },
      };
    }
  }

  // FK validation for BAS category
  if (data.defaultBasCategoryCode) {
    const fkError = await validateBasCategoryFK(tx, data.defaultBasCategoryCode);
    if (fkError) return { error: fkError };
  }

  // one partner per name / VAT number (D70)
  const duplicate = await partnerDuplicate(tx, { name: data.name, vatNumber: data.vatNumber });
  if (duplicate) return { error: duplicate };

  try {
    const partner = await tx.partner.create({
      data: {
        tenantId: caller.tenantId,
        name: data.name,
        shortCode: data.shortCode || null,
        orgNumber: data.orgNumber || null,
        vatNumber: data.vatNumber || null,
        types: data.types,
        defaultCurrency: data.defaultCurrency || null,
        defaultLanguage: data.defaultLanguage || null,
        defaultBasCategoryCode: data.defaultBasCategoryCode || null,
        paymentTermsDays: data.paymentTermsDays ?? null,
        externalIdentifiers: identifiersToJson(data.externalIdentifiers ?? []),
        email: data.email || null,
        phone: data.phone || null,
        address: addressToJson(data.address),
        createdBy: caller.userId,
        source: caller.source,
      },
    });

    await audit.log({
      action: "create",
      entityType: "partner",
      entityId: partner.id,
      newData: toAuditData(partner),
    });

    return { data: { id: partner.id } };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: "A partner with this org number or short code already exists in this tenant",
          retryable: false,
        },
      };
    }
    throw error;
  }
}

export async function updatePartner(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  data: Omit<UpdatePartnerInput, "id">,
): Promise<ServiceResult<{ updated: boolean }>> {
  const existing = await tx.partner.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }

  // Validate types if provided
  if (data.types !== undefined) {
    const typesResult = z.array(partnerTypeSchema).min(1).safeParse(data.types);
    if (!typesResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "At least one valid type required",
          retryable: false,
        },
      };
    }
  }

  // Validate external identifiers if provided
  if (data.externalIdentifiers !== undefined) {
    const eiResult = z.array(externalIdentifierSchema).max(5).safeParse(data.externalIdentifiers);
    if (!eiResult.success) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external identifiers",
          retryable: false,
        },
      };
    }
  }

  // FK validation for BAS category if changed
  if (data.defaultBasCategoryCode !== undefined && data.defaultBasCategoryCode !== null) {
    const fkError = await validateBasCategoryFK(tx, data.defaultBasCategoryCode);
    if (fkError) return { error: fkError };
  }

  // one partner per name / VAT number (D70): a rename or a new VAT number may not land on another one
  if (data.name !== undefined || data.vatNumber !== undefined) {
    const duplicate = await partnerDuplicate(
      tx,
      {
        name: data.name !== undefined ? data.name : null,
        vatNumber: data.vatNumber !== undefined ? data.vatNumber : null,
      },
      id,
    );
    if (duplicate) return { error: duplicate };
  }

  // Type-removal guard: prevent removing types referenced by active contracts
  if (data.types !== undefined) {
    // Lazy: contracts imports partners (getPartner) — a static import here would be a cycle.
    const { activeContractCount } = await import("@/modules/contracts");
    const removingClient = existing.types.includes("client") && !data.types.includes("client");
    if (removingClient) {
      const activeContracts = await activeContractCount(tx, { partnerId: id });
      if (activeContracts > 0) {
        return {
          error: {
            code: "VALIDATION_ERROR",
            message: "Cannot remove client type — partner has active contracts.",
            retryable: false,
          },
        };
      }
    }

    const removingEmployee =
      existing.types.includes("employee") && !data.types.includes("employee");
    if (removingEmployee) {
      const assignedContracts = await activeContractCount(tx, { assignedEmployeeId: id });
      if (assignedContracts > 0) {
        return {
          error: {
            code: "VALIDATION_ERROR",
            message: "Cannot remove employee type — partner is assigned to active contracts.",
            retryable: false,
          },
        };
      }
    }
  }

  // Build update data — only include provided fields
  const updateData: Prisma.PartnerUncheckedUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.shortCode !== undefined) updateData.shortCode = data.shortCode || null;
  if (data.orgNumber !== undefined) updateData.orgNumber = data.orgNumber || null;
  if (data.vatNumber !== undefined) updateData.vatNumber = data.vatNumber || null;
  if (data.types !== undefined) updateData.types = data.types;
  if (data.defaultCurrency !== undefined) updateData.defaultCurrency = data.defaultCurrency || null;
  if (data.defaultLanguage !== undefined) updateData.defaultLanguage = data.defaultLanguage || null;
  if (data.defaultBasCategoryCode !== undefined)
    updateData.defaultBasCategoryCode = data.defaultBasCategoryCode || null;
  if (data.paymentTermsDays !== undefined) updateData.paymentTermsDays = data.paymentTermsDays;
  if (data.externalIdentifiers !== undefined)
    updateData.externalIdentifiers = identifiersToJson(data.externalIdentifiers);
  if (data.email !== undefined) updateData.email = data.email || null;
  if (data.phone !== undefined) updateData.phone = data.phone || null;
  if (data.address !== undefined) updateData.address = addressToJson(data.address);

  try {
    const updated = await tx.partner.update({
      where: { id },
      data: updateData,
    });

    await audit.log({
      action: "update",
      entityType: "partner",
      entityId: id,
      oldData: toAuditData(existing),
      newData: toAuditData(updated),
    });

    return { data: { updated: true } };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: "A partner with this org number or short code already exists in this tenant",
          retryable: false,
        },
      };
    }
    throw error;
  }
}

export async function deactivatePartner(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deactivated: boolean }>> {
  const existing = await tx.partner.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }
  if (!existing.isActive) {
    return {
      error: { code: "VALIDATION_ERROR", message: "Partner is already inactive", retryable: false },
    };
  }

  const updated = await tx.partner.update({
    where: { id },
    data: { isActive: false },
  });

  await audit.log({
    action: "deactivate",
    entityType: "partner",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { deactivated: true } };
}

export async function reactivatePartner(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ reactivated: boolean }>> {
  const existing = await tx.partner.findUnique({ where: { id } });
  if (!existing) {
    return { error: { code: "NOT_FOUND", message: `Partner not found: ${id}`, retryable: false } };
  }
  if (existing.isActive) {
    return {
      error: { code: "VALIDATION_ERROR", message: "Partner is already active", retryable: false },
    };
  }

  const updated = await tx.partner.update({
    where: { id },
    data: { isActive: true },
  });

  await audit.log({
    action: "reactivate",
    entityType: "partner",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { reactivated: true } };
}

export async function searchPartners(
  tx: TransactionClient,
  query: string,
  limit = 20,
): Promise<ServiceResult<PartnerSummaryDto[]>> {
  const partners = await tx.partner.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { orgNumber: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      shortCode: true,
      types: true,
      defaultCurrency: true,
      defaultBasCategoryCode: true,
      systemRole: true,
    },
    orderBy: { name: "asc" },
    take: Math.min(limit, 20),
  });
  return {
    data: partners.map((p) => ({
      ...p,
      systemRole: isSystemRole(p.systemRole) ? p.systemRole : null,
    })),
  };
}

// --- the system partners (F129, D73): the bank, the two tax agencies, the owner as employee ---

/** The currency of a tax agency's country: the ISO code that starts with the country (`SE` → SEK, `CH` → CHF). */
const currencyOfCountry = (country: "SE" | "CH"): Currency | null =>
  CURRENCIES.find((c) => c.startsWith(country)) ?? null;
/** What each role is seeded as: the type and the default currency; the bank's name is the format's, the owner's his. */
const SYSTEM_PARTNER_SEED: Readonly<
  Record<SystemRole, { types: PartnerType[]; defaultCurrency: Currency | null }>
> = {
  bank: { types: ["vendor"], defaultCurrency: null },
  tax_agency_se: { types: ["authority"], defaultCurrency: currencyOfCountry("SE") },
  tax_agency_ch: { types: ["authority"], defaultCurrency: currencyOfCountry("CH") },
  owner: { types: ["employee"], defaultCurrency: null },
};
/** The names the migration and this service seed under; the owner renames them on /partners whenever he likes. */
export const SYSTEM_PARTNER_NAMES = {
  tax_agency_se: "Skatteverket",
  tax_agency_ch: "Swiss Federal Tax Administration (FTA)",
} as const;
/** A hand-made partner whose folded name is one of these takes the role instead of a twin (D70). */
const ROLE_ALIASES: Readonly<Record<SystemRole, readonly string[]>> = {
  bank: [],
  tax_agency_se: ["skatteverket"],
  tax_agency_ch: [
    "swiss federal tax administration (fta)",
    "swiss federal tax administration",
    "fta",
    "estv",
    "afc",
  ],
  owner: [],
};

/** The active partner holding `role`, or null (none seeded yet, or the owner deactivated it). */
export async function systemPartner(
  tx: TransactionClient,
  role: SystemRole,
  /** narrows it for a caller outside RLS (the seed, a CLI as the migration role) — lessons *F129 build* (T026) */
  tenantId?: string,
): Promise<PartnerDto | null> {
  const row = await tx.partner.findFirst({
    where: { systemRole: role, isActive: true, ...(tenantId ? { tenantId } : {}) },
  });
  return row ? toPartnerDto(row) : null;
}

/**
 * Every role's partner, active or not (the reasons' proposal says *inactive* rather than *none*), null when unseeded.
 * `tenantId` narrows it for a caller outside RLS (the seed runs as the migration role, which sees every tenant).
 */
export async function systemPartners(
  tx: TransactionClient,
  tenantId?: string,
): Promise<Record<SystemRole, PartnerDto | null>> {
  const rows = await tx.partner.findMany({
    where: { systemRole: { not: null }, ...(tenantId ? { tenantId } : {}) },
  });
  const out = Object.fromEntries(SYSTEM_ROLES.map((r) => [r, null])) as Record<
    SystemRole,
    PartnerDto | null
  >;
  for (const row of rows) if (isSystemRole(row.systemRole)) out[row.systemRole] = toPartnerDto(row);
  return out;
}

/**
 * The four partners once per tenant (F129 US4): the bank (`bankName` — the format of the tenant's statement
 * accounts), Skatteverket, the Swiss FTA, the owner as employee (the owner member's user name). Idempotent: a role
 * held is left alone; a hand-made partner whose folded name says it is the one takes the role (D70 would refuse
 * the twin); the rest are created, audited. Called by the first import (before the default rules, which name the
 * bank) and by the seed — never by the tenant hook: the kernel imports no module.
 */
export async function ensureSystemPartners(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  options: { bankName: string },
): Promise<ServiceResult<{ created: SystemRole[]; attached: SystemRole[] }>> {
  const held = await systemPartners(tx, caller.tenantId);
  const missing = SYSTEM_ROLES.filter((r) => held[r] === null);
  if (missing.length === 0) return { data: { created: [], attached: [] } };

  const names: Record<SystemRole, string> = {
    bank: options.bankName.trim() || "Bank",
    tax_agency_se: SYSTEM_PARTNER_NAMES.tax_agency_se,
    tax_agency_ch: SYSTEM_PARTNER_NAMES.tax_agency_ch,
    owner: await ownerName(tx, caller),
  };
  const candidates = await tx.partner.findMany({
    where: { tenantId: caller.tenantId, systemRole: null },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const created: SystemRole[] = [];
  const attached: SystemRole[] = [];
  for (const role of missing) {
    const folded = new Set([foldPartnerName(names[role]), ...ROLE_ALIASES[role]]);
    const existing = candidates.find((c) => folded.has(foldPartnerName(c.name)));
    if (existing) {
      await tx.partner.update({ where: { id: existing.id }, data: { systemRole: role } });
      await audit.log({
        action: "update",
        entityType: "partner",
        entityId: existing.id,
        oldData: { systemRole: null },
        newData: { systemRole: role },
      });
      candidates.splice(candidates.indexOf(existing), 1);
      attached.push(role);
      continue;
    }
    const seed = SYSTEM_PARTNER_SEED[role];
    const partner = await tx.partner.create({
      data: {
        tenantId: caller.tenantId,
        name: names[role],
        types: seed.types,
        defaultCurrency: seed.defaultCurrency,
        systemRole: role,
        createdBy: caller.userId,
        source: caller.source,
      },
    });
    await audit.log({
      action: "create",
      entityType: "partner",
      entityId: partner.id,
      newData: toAuditData(partner),
    });
    created.push(role);
  }
  return { data: { created, attached } };
}

/** The owner as employee is named after the tenant's owner member — the caller when he is one, else the oldest owner. */
async function ownerName(tx: TransactionClient, caller: CallerIdentity): Promise<string> {
  const members = await tenantMembers(tx, caller.tenantId);
  const owners = members.filter((m) => isOwnerMembership(m.role));
  const userId =
    owners.find((m) => m.userId === caller.userId)?.userId ?? owners[0]?.userId ?? caller.userId;
  const name = (await userName(tx, userId))?.trim();
  return name || "Owner";
}

/** The Better Auth membership role of an owner — one lookup, never a comparison in the module (the guard). */
const OWNER_MEMBERSHIPS: ReadonlySet<string> = new Set(["owner"]);
const isOwnerMembership = (role: string) => OWNER_MEMBERSHIPS.has(role);
